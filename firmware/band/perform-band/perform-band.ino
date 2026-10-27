// PerForm band firmware v2.
//
// Board: Seeed XIAO nRF52840 Sense, core "Seeed nRF52 mbed-enabled Boards"
// (FQBN Seeeduino:mbed:xiaonRF52840Sense), libraries "Seeed Arduino LSM6DS3"
// and "ArduinoBLE".
//
// Calibration (same as band-test):
//   1. Blue LED: hold still at point 1 until green.
//   2. Blue LED: move to point 2 and hold still until green.
// The band then picks how to count:
//   - tilt mode when the two points differ by >= 25 deg (wrist turns, as in a curl);
//   - height mode when they differ by >= 5 cm of height but not in angle
//     (straight up/down, as in a squat or a press).
//   3. LED off: each rep flashes red (tilt mode) or green (height mode).
//
// Height comes from the accelerometer with gravity taken out, integrated into
// vertical speed. Speed is reset to zero whenever the band is still and is
// pulled gently back to zero while moving, so it doesn't drift. A rep is a move
// towards point 2 followed by a move back.
//
// USB serial (115200) prints CSV at 100 Hz:
//   t_ms,ax,ay,az,gx,gy,gz,pos,vz,h,reps,state,mode
// ax..az in g, gx..gz in deg/s, pos = tilt position (0 at point 1, 1 at point 2),
// vz = vertical speed (m/s, up positive), h = height since point 1 (m).
// Lines starting with '#' are events. Send 'r' to recalibrate.
//
// Bluetooth LE, name "PerForm Band", service 8c1f0001-3b6e-4a6f-9b8e-5f0e2d7a4c10:
//   ...0002 reps    (read/notify, 8 bytes LE): uint16 reps, uint8 mode, uint8 state,
//                   uint16 rom_mm (height mode), uint16 peak_speed_mm_s
//   ...0003 stream  (notify, 20 bytes LE, 50 Hz while subscribed): uint16 t_ms (wraps),
//                   int16 ax,ay,az (mg), int16 gx,gy,gz (0.1 deg/s), int16 pos*1000,
//                   int16 vz (mm/s), int16 h (mm)
//   ...0004 control (write, 1 byte): 'r' = recalibrate

#include <ArduinoBLE.h>
#include <LSM6DS3.h>
#include <Wire.h>
#include <math.h>

LSM6DS3 imu(I2C_MODE, 0x6A);

const unsigned long PERIOD_US = 5000;  // 200 Hz
const float DT = 0.005;
const int SERIAL_EVERY = 2;            // 100 Hz
const int BLE_EVERY = 4;               // 50 Hz
const float GRAV = 9.81;

const float STILL_GYRO_DPS = 8.0;      // still = gyro below this...
const float STILL_ACC_G = 0.03;        // ...and |accel| within this of gravity
const unsigned long ZUPT_MS = 60;      // still this long -> speed is zero
const unsigned long HOLD_MS = 1500;    // still this long -> calibration point saved
const float MIN_ANGLE_DEG = 25.0;
const float MIN_HEIGHT_M = 0.05;
const float POS_LOW = 0.25, POS_HIGH = 0.75;  // tilt rep hysteresis
const float SPEED_GO = 0.10;           // m/s, a move has started
const float SPEED_END = 0.03;          // m/s, a move has ended
const float MIN_ROM_FRACTION = 0.3;    // a height rep must cover this much of the calibrated height
const float LEAK_PER_S = 0.2;          // pulls speed back to zero while moving

enum State { CAL1, CAL1_DONE, CAL2, CAL2_DONE, RUN };
enum Mode { NONE, TILT, HEIGHT };
State state = CAL1;
Mode mode = NONE;

float grav[3] = {0, 0, 1};       // gravity in board frame (g), tracked with the gyro
float gMag = 1.0;                // gravity magnitude as this sensor reads it at rest
float gyroBias[3] = {0, 0, 0};
float pt1[3], pt2[3], axisN[3];  // calibration points (unit) and tilt axis
float span = 1;                  // tilt angle pt1 -> pt2 (rad)
float vz = 0, h = 0;             // vertical speed (m/s) and height (m)
float calHeight = 0;             // calibrated height pt1 -> pt2 (m), height mode
int dir = 1;                     // +1 if point 2 is above point 1

unsigned long stillSince = 0, stateSince = 0, flashUntil = 0, lastUs = 0;
unsigned long tick = 0;
int reps = 0;
bool reachedHigh = false;        // tilt mode
int phase = 0;                   // height mode: 0 at 1, 1 going, 2 at 2, 3 returning
float moveStartH = 0, repRom = 0, repPeak = 0;
bool bleOk = false;

BLEService bandService("8c1f0001-3b6e-4a6f-9b8e-5f0e2d7a4c10");
BLECharacteristic repsChar("8c1f0002-3b6e-4a6f-9b8e-5f0e2d7a4c10", BLERead | BLENotify, 8);
BLECharacteristic streamChar("8c1f0003-3b6e-4a6f-9b8e-5f0e2d7a4c10", BLENotify, 20);
BLEByteCharacteristic controlChar("8c1f0004-3b6e-4a6f-9b8e-5f0e2d7a4c10", BLEWrite | BLEWriteWithoutResponse);
BLEDescriptor repsDesc("2901", "Reps");
BLEDescriptor streamDesc("2901", "IMU stream");
BLEDescriptor controlDesc("2901", "Control");

// LEDs are active low
void led(bool r, bool gr, bool b) {
  digitalWrite(LEDR, r ? LOW : HIGH);
  digitalWrite(LEDG, gr ? LOW : HIGH);
  digitalWrite(LEDB, b ? LOW : HIGH);
}

float dot(const float *a, const float *b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
float norm(const float *v) { return sqrt(dot(v, v)); }
void cross(const float *a, const float *b, float *o) {
  o[0] = a[1]*b[2] - a[2]*b[1];
  o[1] = a[2]*b[0] - a[0]*b[2];
  o[2] = a[0]*b[1] - a[1]*b[0];
}
void scaleTo(float *v, float len) {
  float m = norm(v);
  if (m > 1e-6) { v[0] *= len / m; v[1] *= len / m; v[2] *= len / m; }
}
float angleDeg(const float *a, const float *b) {
  float c = constrain(dot(a, b) / (norm(a) * norm(b)), -1.0f, 1.0f);
  return acos(c) * 180.0 / PI;
}

// Signed angle from pt1 to the current gravity, around the pt1->pt2 axis,
// as a fraction of the pt1->pt2 angle.
float tiltPosition() {
  float u[3] = { grav[0], grav[1], grav[2] };
  scaleTo(u, 1);
  float d = dot(u, axisN), ip[3] = { u[0] - d*axisN[0], u[1] - d*axisN[1], u[2] - d*axisN[2] };
  float c[3]; cross(pt1, ip, c);
  return atan2(dot(c, axisN), dot(pt1, ip)) / span;
}

void printHeader() { Serial.println("t_ms,ax,ay,az,gx,gy,gz,pos,vz,h,reps,state,mode"); }

void publishReps() {
  if (!bleOk) return;
  uint16_t rom = (uint16_t)constrain(repRom * 1000, 0, 65535);
  uint16_t peak = (uint16_t)constrain(repPeak * 1000, 0, 65535);
  uint8_t b[8] = { (uint8_t)reps, (uint8_t)(reps >> 8), (uint8_t)mode, (uint8_t)state,
                   (uint8_t)rom, (uint8_t)(rom >> 8), (uint8_t)peak, (uint8_t)(peak >> 8) };
  repsChar.writeValue(b, 8);
}

void enter(State s) {
  state = s;
  stateSince = millis();
  stillSince = 0;
  publishReps();
}

void startCalibration() {
  reps = 0;
  reachedHigh = false;
  phase = 0;
  mode = NONE;
  repRom = repPeak = 0;
  printHeader();
  Serial.println("# calibrate: hold still at point 1");
  enter(CAL1);
}

void countRep() {
  reps++;
  flashUntil = millis() + 200;
  Serial.print("# rep "); Serial.print(reps);
  Serial.print(" rom_cm "); Serial.print(repRom * 100, 1);
  Serial.print(" peak_m_s "); Serial.println(repPeak, 2);
  publishReps();
  repPeak = 0;
}

void setupBle() {
  if (!BLE.begin()) { Serial.println("# BLE failed to start, USB only"); return; }
  BLE.setLocalName("PerForm Band");
  BLE.setDeviceName("PerForm Band");
  BLE.setAdvertisedService(bandService);
  repsChar.addDescriptor(repsDesc);
  streamChar.addDescriptor(streamDesc);
  controlChar.addDescriptor(controlDesc);
  bandService.addCharacteristic(repsChar);
  bandService.addCharacteristic(streamChar);
  bandService.addCharacteristic(controlChar);
  BLE.addService(bandService);
  bleOk = true;
  publishReps();
  BLE.advertise();
  Serial.println("# BLE advertising as PerForm Band");
}

void put16(uint8_t *b, int i, int v) {
  int16_t s = (int16_t)constrain(v, -32768, 32767);
  b[i] = (uint8_t)s;
  b[i + 1] = (uint8_t)(s >> 8);
}

void setup() {
  pinMode(LEDR, OUTPUT); pinMode(LEDG, OUTPUT); pinMode(LEDB, OUTPUT);
  led(false, false, false);
  Serial.begin(115200);
  // Don't wait for the serial port, so the board also runs on battery.
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 2000) {}
  if (imu.begin() != 0) {
    Serial.println("# error: IMU not found");
    while (true) { led(true, false, false); delay(200); led(false, false, false); delay(200); }
  }
  // Start from the gravity and gyro offset the sensor actually reads
  // (this one reads ~1.04 g and ~6 deg/s at rest).
  float sum[3] = {0, 0, 0}, wSum[3] = {0, 0, 0};
  for (int n = 0; n < 100; n++) {
    sum[0] += imu.readFloatAccelX(); sum[1] += imu.readFloatAccelY(); sum[2] += imu.readFloatAccelZ();
    wSum[0] += imu.readFloatGyroX(); wSum[1] += imu.readFloatGyroY(); wSum[2] += imu.readFloatGyroZ();
    delay(5);
  }
  for (int i = 0; i < 3; i++) grav[i] = sum[i] / 100;
  gMag = norm(grav);
  float wMean[3] = { wSum[0] / 100, wSum[1] / 100, wSum[2] / 100 };
  if (norm(wMean) < 15) for (int i = 0; i < 3; i++) gyroBias[i] = wMean[i];  // only if it was lying still
  setupBle();
  startCalibration();
  lastUs = micros();
}

void loop() {
  if (bleOk) {
    BLE.poll();
    if (controlChar.written() && controlChar.value() == 'r') startCalibration();
  }
  if (Serial.available() && Serial.read() == 'r') startCalibration();

  unsigned long nowUs = micros();
  if (nowUs - lastUs < PERIOD_US) return;
  lastUs = (nowUs - lastUs > 4 * PERIOD_US) ? nowUs : lastUs + PERIOD_US;
  unsigned long now = millis();
  tick++;

  float a[3] = { imu.readFloatAccelX(), imu.readFloatAccelY(), imu.readFloatAccelZ() };
  float wRaw[3] = { imu.readFloatGyroX(), imu.readFloatGyroY(), imu.readFloatGyroZ() };
  float w[3] = { wRaw[0] - gyroBias[0], wRaw[1] - gyroBias[1], wRaw[2] - gyroBias[2] };
  float aMag = norm(a);

  // This sensor reads ~1.04 g at rest, so learn the rest magnitude whenever the
  // gyro says the board isn't turning; otherwise the board never counts as still.
  bool gyroStill = norm(w) < STILL_GYRO_DPS;
  if (gyroStill && fabs(aMag - gMag) < 0.15) gMag += 0.001 * (aMag - gMag);
  bool stillNow = gyroStill && fabs(aMag - gMag) < STILL_ACC_G;
  if (!stillNow) stillSince = 0;
  else if (!stillSince) stillSince = now;
  bool zupt = stillSince && now - stillSince >= ZUPT_MS;
  bool heldStill = stillSince && now - stillSince >= HOLD_MS;

  // Gravity in the board frame turns opposite to the board: dg/dt = -w x g.
  float om[3] = { w[0] * DEG_TO_RAD, w[1] * DEG_TO_RAD, w[2] * DEG_TO_RAD }, c[3];
  cross(om, grav, c);
  for (int i = 0; i < 3; i++) grav[i] -= c[i] * DT;
  // Lean on the accelerometer when it reads close to plain gravity.
  float k = zupt ? 0.05 : (fabs(aMag - gMag) < 0.1 ? 0.005 : 0);
  for (int i = 0; i < 3; i++) grav[i] += k * (a[i] - grav[i]);
  if (zupt) {
    for (int i = 0; i < 3; i++) gyroBias[i] += 0.002 * (wRaw[i] - gyroBias[i]);
  }
  scaleTo(grav, gMag);

  // Vertical acceleration without gravity, up positive (m/s^2).
  float lin = (dot(a, grav) / gMag - gMag) * GRAV;
  if (zupt) vz = 0;
  else vz += (lin - LEAK_PER_S * vz) * DT;
  h += vz * DT;

  float pos = 0;
  switch (state) {
    case CAL1:
      led(false, false, true);
      if (heldStill) {
        for (int i = 0; i < 3; i++) pt1[i] = grav[i];
        scaleTo(pt1, 1);
        Serial.println("# point 1 saved");
        enter(CAL1_DONE);
      }
      break;
    case CAL1_DONE:
    case CAL2_DONE:
      led(false, true, false);
      if (now - stateSince > 1500) {
        if (state == CAL1_DONE) {
          h = 0;
          enter(CAL2);
          Serial.println("# move to point 2 and hold still");
        } else {
          h = 0;
          enter(RUN);
          Serial.println(mode == TILT ? "# ready (tilt): move between the points"
                                      : "# ready (height): move between the points");
        }
      }
      break;
    case CAL2:
      led(false, false, true);
      if (heldStill) {
        float ang = angleDeg(grav, pt1);
        if (ang >= MIN_ANGLE_DEG) {
          for (int i = 0; i < 3; i++) pt2[i] = grav[i];
          scaleTo(pt2, 1);
          cross(pt1, pt2, axisN);
          scaleTo(axisN, 1);
          span = ang * DEG_TO_RAD;
          mode = TILT;
          Serial.print("# point 2 saved, tilt mode, angle "); Serial.println(ang, 1);
          enter(CAL2_DONE);
        } else if (fabs(h) >= MIN_HEIGHT_M) {
          calHeight = fabs(h);
          dir = h > 0 ? 1 : -1;
          mode = HEIGHT;
          Serial.print("# point 2 saved, height mode, height_cm "); Serial.println(h * 100, 1);
          enter(CAL2_DONE);
        }
      }
      break;
    case RUN:
      if (fabs(vz) > repPeak) repPeak = fabs(vz);
      if (mode == TILT) {
        pos = tiltPosition();
        if (pos > POS_HIGH) reachedHigh = true;
        if (reachedHigh && pos < POS_LOW) {
          reachedHigh = false;
          repRom = 0;
          countRep();
        }
        led(now < flashUntil, false, false);
      } else {
        float v = vz * dir;  // positive = towards point 2
        switch (phase) {
          case 0:
            if (v > SPEED_GO) { phase = 1; moveStartH = h; repPeak = v; }
            break;
          case 1:
            if (v < SPEED_END || v < -SPEED_GO) {
              repRom = (h - moveStartH) * dir;
              // too short: a twitch or a knock, not a rep
              phase = repRom >= MIN_ROM_FRACTION * calHeight ? (v < -SPEED_GO ? 3 : 2) : 0;
            }
            break;
          case 2:
            if (v < -SPEED_GO) phase = 3;
            else if (v > SPEED_GO) { phase = 1; }  // kept going up after a pause
            break;
          case 3:
            if (v > -SPEED_END) { phase = 0; countRep(); }
            break;
        }
        led(false, now < flashUntil, false);
      }
      break;
  }

  if (tick % SERIAL_EVERY == 0) {
    Serial.print(now); Serial.print(',');
    for (int i = 0; i < 3; i++) { Serial.print(a[i], 3); Serial.print(','); }
    for (int i = 0; i < 3; i++) { Serial.print(wRaw[i], 1); Serial.print(','); }
    Serial.print(pos, 3); Serial.print(',');
    Serial.print(vz, 3); Serial.print(',');
    Serial.print(h, 3); Serial.print(',');
    Serial.print(reps); Serial.print(',');
    Serial.print((int)state); Serial.print(',');
    Serial.println((int)mode);
  }

  if (bleOk && tick % BLE_EVERY == 0 && streamChar.subscribed()) {
    uint8_t b[20];
    b[0] = (uint8_t)now;
    b[1] = (uint8_t)(now >> 8);
    for (int i = 0; i < 3; i++) put16(b, 2 + 2*i, (int)(a[i] * 1000));
    for (int i = 0; i < 3; i++) put16(b, 8 + 2*i, (int)(wRaw[i] * 10));
    put16(b, 14, (int)(pos * 1000));
    put16(b, 16, (int)(vz * 1000));
    put16(b, 18, (int)(h * 1000));
    streamChar.writeValue(b, 20);
  }
}

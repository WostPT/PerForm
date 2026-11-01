// PerForm band firmware v3: Miguel's calibration design (2026-10-31).
//
// Board: Seeed XIAO nRF52840 Sense, core "Seeed nRF52 mbed-enabled Boards"
// (FQBN Seeeduino:mbed:xiaonRF52840Sense), libraries "Seeed Arduino LSM6DS3"
// and "ArduinoBLE".
//
// Calibration, once per exercise (send 'r' over USB or BLE to start a new one):
//   1. Blue blinking: go to point 1 and hold (a shaky hand is fine). After 1.5 s the LED is
//      solid green for 1 s: point 1 saved.
//   2. Purple blinking: go to point 2 and hold still. Solid green 1 s: saved.
//      Point 2 can differ in height, in tilt, or both. Less than 5 cm and 15 deg
//      is not enough: it keeps blinking purple.
//   The band follows whichever changed more: tilt, height, or both when both
//   changed a lot (then tilt counts the reps, as it doesn't drift, and height
//   gives the range of motion). The calibration is saved in flash and loaded at
//   power-up (solid green for 1 s, then counting). In height mode the first 3
//   reps fine-tune point 2's distance (averaged with the calibration move), since
//   one calibration move is often 10-20% off; the tuned value is saved.
//
// Reps, LED off: one rep = from one point to at least 80% of the way to the
// other and back, starting at either point (e.g. at the top for a squat). Full rep: short green flash. Turned back between 50% and 80%: short
// red flash, counted as a partial, not a rep.
//
// Height comes from the accelerometer with gravity taken out, integrated into
// vertical speed. Speed is reset to zero whenever the band is still and is
// pulled gently back to zero while moving, so it doesn't drift.
//
// USB serial (115200) prints CSV at 50 Hz, integers only:
//   t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps,pos_milli,vz_mm_s,h_mm,reps,partials,state,mode
// accel in mg, gyro in 0.1 deg/s, pos = tilt position x1000 (0 at point 1,
// 1000 at point 2), vz = vertical speed (mm/s, up positive), h = height (mm).
// state: 0 point 1, 1 point 1 saved, 2 point 2, 3 point 2 saved, 4 counting.
// mode: 0 none, 1 tilt, 2 height, 3 both. Lines starting with '#' are events.
//
// Bluetooth LE, name "PerForm Band", service 8c1f0001-3b6e-4a6f-9b8e-5f0e2d7a4c10:
//   ...0002 reps    (read/notify, 10 bytes LE): uint16 reps, uint16 partials,
//                   uint8 mode, uint8 state, uint16 rom_mm, uint16 peak_speed_mm_s
//   ...0003 stream  (notify, 20 bytes LE, 25 Hz while subscribed): uint16 t_ms (wraps),
//                   int16 ax,ay,az (mg), int16 gx,gy,gz (0.1 deg/s), int16 pos*1000,
//                   int16 vz (mm/s), int16 h (mm)
//   ...0004 control (write, 1 byte): 'r' = recalibrate, 'w' = wipe saved calibration and recalibrate

#include <ArduinoBLE.h>
#include <LSM6DS3.h>
#include <Wire.h>
#include <math.h>
#if __has_include("kvstore_global_api.h")
#include "kvstore_global_api.h"
#define HAVE_KV 1
#endif

LSM6DS3 imu(I2C_MODE, 0x6A);

const unsigned long PERIOD_US = 5000;  // aim for 200 Hz; the real step is measured
const unsigned long SERIAL_MS = 20;    // CSV at 50 Hz
const unsigned long BLE_MS = 40;       // stream at 25 Hz
const float GRAV = 9.81;

const float STILL_GYRO_DPS = 8.0;      // still = gyro below this...
const float STILL_ACC_G = 0.03;        // ...and |accel| within this of gravity
// Speed is only reset to zero when the band is really still: a slow, smooth
// lift barely accelerates and would otherwise look still and lose its height.
const float ZUPT_GYRO_DPS = 4.0;
const float ZUPT_ACC_G = 0.012;
const unsigned long ZUPT_MS = 150;
const unsigned long STILL_ZUPT_MS = 400;
const unsigned long HOLD_MS = 1500;    // held this long -> calibration point saved
// "Holding" a point tolerates a shaky hand: a real hand wobbles at 10-40 deg/s
// even when trying to keep still, while a real move turns and accelerates more.
const float HOLD_GYRO_DPS = 45.0;
const float HOLD_ACC_G = 0.08;
const float MIN_ANGLE_DEG = 15.0;      // point 2 must differ by this much tilt...
const float MIN_HEIGHT_M = 0.05;       // ...or this much height
const float MAX_HEIGHT_M = 1.2;        // more than this is drift, not a real move
const float BIG_ANGLE_DEG = 25.0;      // "changed a lot", for picking tilt, height or both
const float BIG_HEIGHT_M = 0.10;
const float FULL_REP = 0.8;            // fraction of the way to point 2 for a rep
const float PARTIAL_REP = 0.5;         // ...and for a partial
const float POS_LEAVE = 0.35, POS_BACK = 0.3;  // tilt: left point 1 / back at point 1
const float SPEED_GO = 0.10;           // m/s, a move has started
const float SPEED_END = 0.03;          // m/s, a move has ended
const float TWITCH_FRACTION = 0.2;     // height moves shorter than this are ignored
const int TUNE_REPS = 3;               // height: fine-tune point 2 from this many first reps
const float TUNE_MIN = 0.6;            // ...that went at least this far
const float LEAK_PER_S = 0.2;          // pulls speed back to zero while moving

enum State { CAL1, CAL1_DONE, CAL2, CAL2_DONE, RUN };
enum Mode { NONE, TILT, HEIGHT, BOTH };
State state = CAL1;
Mode mode = NONE;

float grav[3] = {0, 0, 1};       // gravity in board frame (g), tracked with the gyro
float gMag = 1.0;                // gravity magnitude as this sensor reads it at rest
float gyroBias[3] = {0, 0, 0};
float pt1[3], pt2[3], axisN[3];  // calibration points (unit) and tilt axis
float span = 1;                  // tilt angle pt1 -> pt2 (rad)
float vz = 0, h = 0;             // vertical speed (m/s) and height (m)
float calHeight = 0;
float calMeasured = 0, tuneSum = 0;  // height: calibration move and first reps' legs
int tuned = TUNE_REPS;           // height: first reps used so far for fine-tuning             // calibrated height pt1 -> pt2 (m), height mode
int dir = 1;                     // +1 if point 2 is above point 1

unsigned long stillSince = 0, calmSince = 0, holdSince = 0, stateSince = 0, flashUntil = 0, lastUs = 0;
float hPeak = 0;                 // point 2: height where the last move towards it ended
bool calMoving = false;          // point 2: a move is under way
unsigned long lastSerial = 0, lastBle = 0;
bool flashRed = false;
int reps = 0, partials = 0;
// A rep can start at either point: it goes to the other one and comes back.
bool away = false;               // tilt: left the starting point in this rep
int home = 0;                    // tilt: starting point of this rep (0 = point 1, 1 = point 2)
float maxReach = 0;              // tilt: furthest reached in this rep, as a fraction of the way
int phase = 0;                   // height: 0 resting, 1 first leg, 2 turning, 3 coming back
int legDir = 1;                  // height: +1 if the first leg goes up
bool legDirKnown = false;        // height: set by the first rep, then every rep starts that way
float moveStartH = 0, returnStartH = 0, towardRom = 0, repRom = 0, repPeak = 0;
float repMaxH = 0, repMinH = 0;  // height range in this rep, for the reported ROM
bool bleOk = false;

// Saved calibration, so it survives unplugging.
struct Calibration {
  uint32_t magic;
  uint8_t mode;
  int8_t dir;
  float pt1[3], pt2[3], axisN[3], span, calHeight;
};
const uint32_t CAL_MAGIC = 0x50464233;  // "PFB3"


BLEService bandService("8c1f0001-3b6e-4a6f-9b8e-5f0e2d7a4c10");
BLECharacteristic repsChar("8c1f0002-3b6e-4a6f-9b8e-5f0e2d7a4c10", BLERead | BLENotify, 10);
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

void printHeader() { Serial.println("t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps,pos_milli,vz_mm_s,h_mm,reps,partials,state,mode"); }

const char *modeName() {
  return mode == TILT ? "tilt" : mode == HEIGHT ? "height" : mode == BOTH ? "both" : "none";
}

void saveCalibration() {
#ifdef HAVE_KV
  Calibration c = { CAL_MAGIC, (uint8_t)mode, (int8_t)dir,
                    { pt1[0], pt1[1], pt1[2] }, { pt2[0], pt2[1], pt2[2] },
                    { axisN[0], axisN[1], axisN[2] }, span, calHeight };
  int err = kv_set("/kv/band_cal", &c, sizeof c, 0);
  Serial.println(err == 0 ? "# calibration saved to flash" : "# could not save calibration");
#else
  Serial.println("# no flash storage in this build, calibration not saved");
#endif
}

void wipeCalibration() {
#ifdef HAVE_KV
  kv_remove("/kv/band_cal");
#endif
  Serial.println("# saved calibration wiped");
}

bool loadCalibration() {
#ifdef HAVE_KV
  Calibration c;
  size_t got = 0;
  if (kv_get("/kv/band_cal", &c, sizeof c, &got) != 0 || got != sizeof c || c.magic != CAL_MAGIC) return false;
  mode = (Mode)c.mode;
  dir = c.dir;
  for (int i = 0; i < 3; i++) { pt1[i] = c.pt1[i]; pt2[i] = c.pt2[i]; axisN[i] = c.axisN[i]; }
  span = c.span;
  calHeight = c.calHeight;
  return mode != NONE && calHeight <= MAX_HEIGHT_M;  // older builds could save a drifted height
#else
  return false;
#endif
}

// Accel (g) and gyro (deg/s) in one 12-byte I2C burst: gyro X..Z then accel X..Z.
void readImu(float *a, float *w) {
  uint8_t b[12];
  imu.readRegisterRegion(b, LSM6DS3_ACC_GYRO_OUTX_L_G, 12);
  for (int i = 0; i < 3; i++) {
    w[i] = imu.calcGyro((int16_t)(b[2*i] | (b[2*i + 1] << 8)));
    a[i] = imu.calcAccel((int16_t)(b[6 + 2*i] | (b[6 + 2*i + 1] << 8)));
  }
}

void publishReps() {
  if (!bleOk) return;
  uint16_t rom = (uint16_t)constrain(repRom * 1000, 0, 65535);
  uint16_t peak = (uint16_t)constrain(repPeak * 1000, 0, 65535);
  uint8_t b[10] = { (uint8_t)reps, (uint8_t)(reps >> 8), (uint8_t)partials, (uint8_t)(partials >> 8),
                    (uint8_t)mode, (uint8_t)state,
                    (uint8_t)rom, (uint8_t)(rom >> 8), (uint8_t)peak, (uint8_t)(peak >> 8) };
  repsChar.writeValue(b, 10);
}

void enter(State s) {
  state = s;
  stateSince = millis();
  stillSince = holdSince = 0;
  publishReps();
}

void resetCounting() {
  reps = partials = 0;
  away = false;
  phase = 0;
  legDirKnown = false;
  repRom = repPeak = 0;
  h = repMaxH = repMinH = 0;
}

void startCalibration() {
  resetCounting();
  mode = NONE;
  printHeader();
  Serial.println("# calibrate: go to point 1 and hold still");
  enter(CAL1);
}

// fraction = how far towards point 2 this rep went (1 = all the way).
void endRep(float fraction) {
  bool full = fraction >= FULL_REP;
  if (!full && fraction < PARTIAL_REP) return;  // a small wobble, not a rep
  if (full) reps++; else partials++;
  flashRed = !full;
  flashUntil = millis() + 200;
  repRom = repMaxH - repMinH;
  char line[96];
  snprintf(line, sizeof line, "# %s %d reach_pct %ld rom_mm %ld peak_mm_s %ld\r\n",
           full ? "rep" : "partial", full ? reps : partials, lround(fraction * 100),
           lround(repRom * 1000), lround(repPeak * 1000));
  Serial.write(line, strlen(line));
  publishReps();
}

void startRep() {
  repPeak = 0;
  repMaxH = repMinH = h;
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
  Wire.setClock(400000);
  // Start from the gravity and gyro offset the sensor actually reads
  // (this one reads ~1.04 g and ~6 deg/s at rest).
  float sum[3] = {0, 0, 0}, wSum[3] = {0, 0, 0};
  for (int n = 0; n < 100; n++) {
    float a[3], w[3];
    readImu(a, w);
    for (int i = 0; i < 3; i++) { sum[i] += a[i]; wSum[i] += w[i]; }
    delay(5);
  }
  for (int i = 0; i < 3; i++) grav[i] = sum[i] / 100;
  gMag = norm(grav);
  float wMean[3] = { wSum[0] / 100, wSum[1] / 100, wSum[2] / 100 };
  if (norm(wMean) < 15) for (int i = 0; i < 3; i++) gyroBias[i] = wMean[i];  // only if it was lying still
  setupBle();
  if (loadCalibration()) {
    resetCounting();
    printHeader();
    Serial.print("# loaded saved calibration, mode "); Serial.println(modeName());
    enter(CAL2_DONE);  // shows green, then starts counting
  } else {
    startCalibration();
  }
  lastUs = micros();
}

// 'r' = calibrate again, 'w' = wipe the saved calibration and calibrate again.
void command(int c) {
  if (c == 'w') wipeCalibration();
  if (c == 'r' || c == 'w') startCalibration();
}

void loop() {
  if (bleOk) {
    BLE.poll();
    if (controlChar.written()) command(controlChar.value());
  }
  if (Serial.available()) command(Serial.read());

  unsigned long nowUs = micros();
  if (nowUs - lastUs < PERIOD_US) return;
  // Integrate over the time that really passed: the loop runs slower than
  // PERIOD_US when serial or BLE are busy.
  float DT = min((nowUs - lastUs) * 1e-6f, 0.1f);
  lastUs = nowUs;
  unsigned long now = millis();

  float a[3], wRaw[3];
  readImu(a, wRaw);
  float w[3] = { wRaw[0] - gyroBias[0], wRaw[1] - gyroBias[1], wRaw[2] - gyroBias[2] };
  float aMag = norm(a);

  // This sensor reads ~1.04 g at rest, so learn the rest magnitude whenever the
  // gyro says the board isn't turning; otherwise the board never counts as still.
  bool gyroStill = norm(w) < STILL_GYRO_DPS;
  if (gyroStill && fabs(aMag - gMag) < 0.15) gMag += 0.001 * (aMag - gMag);
  bool stillNow = gyroStill && fabs(aMag - gMag) < STILL_ACC_G;
  if (!stillNow) stillSince = 0;
  else if (!stillSince) stillSince = now;
  bool calmNow = norm(w) < ZUPT_GYRO_DPS && fabs(aMag - gMag) < ZUPT_ACC_G;
  if (!calmNow) calmSince = 0;
  else if (!calmSince) calmSince = now;
  // Speed is zero when really calm for a moment, or simply still for longer
  // (a small sensor offset can keep it from ever looking "really calm").
  bool zupt = (calmSince && now - calmSince >= ZUPT_MS) || (stillSince && now - stillSince >= STILL_ZUPT_MS);
  bool holdingNow = norm(w) < HOLD_GYRO_DPS && fabs(aMag - gMag) < HOLD_ACC_G;
  if (!holdingNow) holdSince = 0;
  else if (!holdSince) holdSince = now;
  bool heldStill = holdSince && now - holdSince >= HOLD_MS;

  // Gravity in the board frame turns opposite to the board: dg/dt = -w x g.
  const float d2r = DEG_TO_RAD;
  float om[3] = { w[0] * d2r, w[1] * d2r, w[2] * d2r }, c[3];
  cross(om, grav, c);
  for (int i = 0; i < 3; i++) grav[i] -= c[i] * DT;
  // Lean on the accelerometer when it reads close to plain gravity, and fully
  // when the band is still: then it reads exactly gravity. Otherwise a small gyro
  // offset tilts the gravity estimate and shows up as a fake vertical acceleration.
  float k = stillNow ? 0.05 : (fabs(aMag - gMag) < 0.1 ? 0.005 : 0);
  for (int i = 0; i < 3; i++) grav[i] += k * (a[i] - grav[i]);
  if (stillNow) {
    for (int i = 0; i < 3; i++) gyroBias[i] += 0.01 * (wRaw[i] - gyroBias[i]);
  }
  scaleTo(grav, gMag);

  // Vertical acceleration without gravity, up positive (m/s^2).
  float lin = (dot(a, grav) / gMag - gMag) * GRAV;
  if (zupt) vz = 0;
  // Less leak while calibrating point 2: that lift is often slow and the full leak
  // would eat part of it. Some leak is still needed, or a tiny offset drifts for metres.
  else vz += (lin - (state == CAL2 ? LEAK_PER_S / 2 : LEAK_PER_S) * vz) * DT;
  h += vz * DT;
  // Point 2's height is where the move ended, read the same way a rep's leg is read
  // (when the speed drops), so calibration and reps share the same measuring errors.
  // Reading it later would let a shaky hold slide it back; the peak overshoots.
  if (state == CAL2) {
    if (!calMoving && fabs(vz) > SPEED_GO) calMoving = true;
    else if (calMoving && fabs(vz) < SPEED_END) { calMoving = false; hPeak = h; }
  }

  float pos = 0;
  bool blinkOn = (now / 200) % 2 == 0;
  switch (state) {
    case CAL1:
      led(false, false, blinkOn);  // blue blinking
      if (heldStill) {
        for (int i = 0; i < 3; i++) pt1[i] = grav[i];
        scaleTo(pt1, 1);
        Serial.println("# point 1 saved");
        enter(CAL1_DONE);
      }
      break;
    case CAL1_DONE:
    case CAL2_DONE:
      led(false, true, false);  // solid green
      if (now - stateSince > 1000) {
        h = vz = hPeak = 0;
        calMoving = false;
        if (state == CAL1_DONE) {
          enter(CAL2);
          Serial.println("# go to point 2 and hold still");
        } else {
          enter(RUN);
          startRep();
          Serial.print("# ready, counting by "); Serial.println(modeName());
        }
      }
      break;
    case CAL2:
      led(blinkOn, false, blinkOn);  // purple blinking
      if (heldStill) {
        // Height = how far the move went, not where it slid back to during the hold.
        float ang = angleDeg(grav, pt1), hgt = fabs(hPeak);
        bool tiltOk = ang >= MIN_ANGLE_DEG, heightOk = hgt >= MIN_HEIGHT_M;
        if (hgt > MAX_HEIGHT_M) {
          // Drifted (e.g. picked up and carried around): start the height over.
          Serial.println("# point 2 height not believable, measuring again");
          h = hPeak = 0;
          stillSince = holdSince = 0;
          break;
        }
        if (tiltOk || heightOk) {
          for (int i = 0; i < 3; i++) pt2[i] = grav[i];
          scaleTo(pt2, 1);
          cross(pt1, pt2, axisN);
          scaleTo(axisN, 1);
          span = ang * DEG_TO_RAD;
          calHeight = calMeasured = hgt;
          tuneSum = 0;
          tuned = 0;
          dir = hPeak >= 0 ? 1 : -1;
          float tiltScore = ang / BIG_ANGLE_DEG, heightScore = hgt / BIG_HEIGHT_M;
          if (tiltScore >= 1 && heightScore >= 1) mode = BOTH;
          else if (tiltOk && (!heightOk || tiltScore >= heightScore)) mode = TILT;
          else mode = HEIGHT;
          char line[96];
          snprintf(line, sizeof line, "# point 2 saved, mode %s, angle_deg %ld, height_mm %ld\r\n",
                   modeName(), lround(ang), lround(hPeak * 1000));
          Serial.write(line, strlen(line));
          saveCalibration();
          enter(CAL2_DONE);
        }
      }
      break;
    case RUN:
      if (fabs(vz) > repPeak) repPeak = fabs(vz);
      if (h > repMaxH) repMaxH = h;
      if (h < repMinH) repMinH = h;
      if (mode == TILT || mode == BOTH) {
        pos = tiltPosition();
        if (!away) home = pos < 0.5 ? 0 : 1;
        float reach = home == 0 ? pos : 1 - pos;
        if (!away && reach > POS_LEAVE) { away = true; maxReach = reach; startRep(); }
        if (away) {
          if (reach > maxReach) maxReach = reach;
          if (reach < POS_BACK) { away = false; endRep(maxReach); }
        }
      } else {
        float v = vz * legDir;  // positive = along the first leg of this rep
        switch (phase) {
          case 0:
            // After the first rep every rep starts the same way, so the tail of a slow
            // return isn't taken for the start of a new rep.
            if (fabs(vz) > SPEED_GO && (!legDirKnown || vz * legDir > 0)) {
              legDir = vz > 0 ? 1 : -1;
              phase = 1;
              moveStartH = h;
              startRep();
            }
            break;
          case 1:
            if (v < SPEED_END) {
              towardRom = (h - moveStartH) * legDir;
              if (towardRom < TWITCH_FRACTION * calHeight) phase = 0;  // a twitch or a knock
              else { phase = v < -SPEED_GO ? 3 : 2; returnStartH = h; }
            }
            break;
          case 2:
            if (v < -SPEED_GO) { phase = 3; returnStartH = h; }
            else if (v > SPEED_GO) phase = 1;  // kept going after a pause
            break;
          case 3: {
            // The rep ends back near where it started: at least halfway back (or when
            // the band stops), so the flash comes at the start point, not at the turn.
            float back = (returnStartH - h) * legDir;
            if ((v > -SPEED_END && back >= 0.5 * towardRom) || zupt) {
              // Fast moves can read short in one direction, so take the longer leg.
              phase = 0;
              float leg = max(towardRom, back);
              legDirKnown = true;
              // One calibration move is often 10-20% off: average it with the first
              // few real reps, which are measured the same way.
              if (tuned < TUNE_REPS && leg >= TUNE_MIN * calHeight) {
                tuneSum += leg;
                tuned++;
                calHeight = (calMeasured + tuneSum) / (1 + tuned);
                char line[64];
                snprintf(line, sizeof line, "# point 2 tuned, height_mm %ld\r\n", lround(calHeight * 1000));
                Serial.write(line, strlen(line));
                if (tuned == TUNE_REPS) saveCalibration();
              }
              endRep(leg / calHeight);
            }
            break;
          }
        }
      }
      led(now < flashUntil && flashRed, now < flashUntil && !flashRed, false);
      break;
  }

  if (now - lastSerial >= SERIAL_MS) {
    lastSerial = now;
    // One write per row: many small prints over USB slow the loop down.
    char line[128];
    snprintf(line, sizeof line, "%lu,%ld,%ld,%ld,%ld,%ld,%ld,%ld,%ld,%ld,%d,%d,%d,%d\r\n", now,
             lround(a[0] * 1000), lround(a[1] * 1000), lround(a[2] * 1000),
             lround(wRaw[0] * 10), lround(wRaw[1] * 10), lround(wRaw[2] * 10),
             lround(pos * 1000), lround(vz * 1000), lround(h * 1000), reps, partials, (int)state, (int)mode);
    Serial.write(line, strlen(line));
  }

  if (bleOk && now - lastBle >= BLE_MS && streamChar.subscribed()) {
    lastBle = now;
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

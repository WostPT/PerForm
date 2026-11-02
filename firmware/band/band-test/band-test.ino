// PerForm band — test firmware (USB only, no battery, no button).
//
// Board: Seeed XIAO nRF52840 Sense, core "Seeed nRF52 mbed-enabled Boards"
// (FQBN Seeeduino:mbed:xiaonRF52840Sense), library "Seeed Arduino LSM6DS3".
//
// Flow:
//   1. Blue LED: hold the board still at point 1 (e.g. arm extended).
//      After ~1.5 s still, LED goes green -> point 1 saved.
//   2. Blue LED again: move to point 2 (e.g. arm contracted) and hold still.
//      It must be tilted at least 25 deg from point 1. Green -> point 2 saved.
//   3. LED off: move between the two points. Each rep flashes the LED red.
//
// Position is read from gravity only (the tilt of the board), so the two
// points must differ in angle, like the wrist in a curl. Pure up/down
// movement without tilting is not seen by this method.
//
// Serial (115200) prints CSV at 50 Hz:
//   t_ms,ax,ay,az,gx,gy,gz,pos,reps,state
// ax..az in g, gx..gz in deg/s, pos = 0 at point 1 and 1 at point 2.
// Lines starting with '#' are events. Send 'r' to recalibrate.

#include <LSM6DS3.h>
#include <Wire.h>
#include <math.h>

LSM6DS3 imu(I2C_MODE, 0x6A);

const unsigned long PERIOD_MS = 20;    // 50 Hz
const float STILL_GYRO_DPS = 10.0;     // below this the board counts as still
const unsigned long STILL_MS = 1500;   // how long it must stay still
const float MIN_ANGLE_DEG = 25.0;      // point 2 must be this far from point 1
const float POS_LOW = 0.25, POS_HIGH = 0.75;  // rep hysteresis

enum State { CAL1, CAL1_DONE, CAL2, CAL2_DONE, RUN };
State state = CAL1;

float g[3] = {0, 0, 1};          // low-passed gravity direction (unit)
float pt1[3], pt2[3], axisN[3];    // calibration points and rotation axis
float span = 1;                  // angle pt1 -> pt2 (rad)
unsigned long stillSince = 0, stateSince = 0, flashUntil = 0, lastTick = 0;
float sum[3]; int sumN = 0;
int reps = 0;
bool reachedHigh = false;

// LEDs are active low
void led(bool r, bool gr, bool b) {
  digitalWrite(LEDR, r ? LOW : HIGH);
  digitalWrite(LEDG, gr ? LOW : HIGH);
  digitalWrite(LEDB, b ? LOW : HIGH);
}

float dot(const float *a, const float *b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
void cross(const float *a, const float *b, float *o) {
  o[0] = a[1]*b[2] - a[2]*b[1];
  o[1] = a[2]*b[0] - a[0]*b[2];
  o[2] = a[0]*b[1] - a[1]*b[0];
}
void normalize(float *v) {
  float m = sqrt(dot(v, v));
  if (m > 1e-6) { v[0] /= m; v[1] /= m; v[2] /= m; }
}
float angleDeg(const float *a, const float *b) {
  float c = constrain(dot(a, b), -1.0f, 1.0f);
  return acos(c) * 180.0 / PI;
}

// Signed angle from pt1 to the current gravity, measured around the pt1->pt2
// axis, as a fraction of the pt1->pt2 angle.
float position() {
  float d = dot(g, axisN), ip[3] = { g[0] - d*axisN[0], g[1] - d*axisN[1], g[2] - d*axisN[2] };
  float c[3]; cross(pt1, ip, c);
  return atan2(dot(c, axisN), dot(pt1, ip)) / span;
}

void enter(State s) {
  state = s;
  stateSince = millis();
  stillSince = 0;
  sumN = 0;
}

void startCalibration() {
  reps = 0;
  reachedHigh = false;
  enter(CAL1);
  Serial.println("# calibrate: hold still at point 1");
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
  Serial.println("t_ms,ax,ay,az,gx,gy,gz,pos,reps,state");
  startCalibration();
}

void loop() {
  if (Serial.available() && Serial.read() == 'r') startCalibration();

  unsigned long now = millis();
  if (now - lastTick < PERIOD_MS) return;
  lastTick = now;

  float a[3] = { imu.readFloatAccelX(), imu.readFloatAccelY(), imu.readFloatAccelZ() };
  float w[3] = { imu.readFloatGyroX(), imu.readFloatGyroY(), imu.readFloatGyroZ() };
  float an[3] = { a[0], a[1], a[2] };
  normalize(an);
  for (int i = 0; i < 3; i++) g[i] += 0.2 * (an[i] - g[i]);
  normalize(g);

  bool still = sqrt(dot(w, w)) < STILL_GYRO_DPS;
  if (!still) { stillSince = 0; sumN = 0; }
  else if (!stillSince) stillSince = now;
  if (still) { for (int i = 0; i < 3; i++) sum[i] = (sumN ? sum[i] : 0) + an[i]; sumN++; }
  bool heldStill = stillSince && now - stillSince >= STILL_MS;

  float pos = 0;
  switch (state) {
    case CAL1:
      led(false, false, true);
      if (heldStill) {
        for (int i = 0; i < 3; i++) pt1[i] = sum[i];
        normalize(pt1);
        Serial.println("# point 1 saved");
        enter(CAL1_DONE);
      }
      break;
    case CAL1_DONE:
    case CAL2_DONE:
      led(false, true, false);
      if (now - stateSince > 1500) {
        if (state == CAL1_DONE) { enter(CAL2); Serial.println("# move to point 2 and hold still"); }
        else { enter(RUN); Serial.println("# ready: move between the points"); }
      }
      break;
    case CAL2: {
      led(false, false, true);
      float cur[3] = { g[0], g[1], g[2] };
      if (heldStill && angleDeg(cur, pt1) >= MIN_ANGLE_DEG) {
        for (int i = 0; i < 3; i++) pt2[i] = sum[i];
        normalize(pt2);
        cross(pt1, pt2, axisN);
        normalize(axisN);
        span = angleDeg(pt1, pt2) * PI / 180.0;
        Serial.print("# point 2 saved, angle ");
        Serial.println(span * 180.0 / PI, 1);
        enter(CAL2_DONE);
      }
      break;
    }
    case RUN:
      pos = position();
      if (pos > POS_HIGH) reachedHigh = true;
      if (reachedHigh && pos < POS_LOW) {
        reachedHigh = false;
        reps++;
        flashUntil = now + 200;
        Serial.print("# rep ");
        Serial.println(reps);
      }
      led(now < flashUntil, false, false);
      break;
  }

  Serial.print(now); Serial.print(',');
  for (int i = 0; i < 3; i++) { Serial.print(a[i], 3); Serial.print(','); }
  for (int i = 0; i < 3; i++) { Serial.print(w[i], 1); Serial.print(','); }
  Serial.print(pos, 3); Serial.print(',');
  Serial.print(reps); Serial.print(',');
  Serial.println((int)state);
}

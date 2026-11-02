// PerForm band firmware v4: learn the exercise from one slow rep (2026-11-01).
//
// Board: Seeed XIAO nRF52840 Sense, core "Seeed nRF52 mbed-enabled Boards"
// (FQBN Seeeduino:mbed:xiaonRF52840Sense), libraries "Seeed Arduino LSM6DS3"
// and "ArduinoBLE".
//
// Learning, once per exercise (send 'r' over USB or BLE to learn a new one):
//   1. Blue blinking: get into the start position of the exercise and hold it
//      (a shaky hand is fine) for 1 s.
//   2. Solid purple: do one slow, full rep and come back to the start. Hold there.
//   3. Solid green for 1 s: learned and saved on the chip, counting starts.
//   The band learns the start position, how far the rep goes and which way it
//   goes. It counts by tilt when the band turns at least 15 deg during the rep
//   (a curl, a raise), otherwise by height when it moves at least 5 cm (a squat,
//   a press with the wrist kept straight). In height mode the first 3 reps
//   fine-tune the distance. The learned rep is loaded again at power-up.
//
// Reps, LED off: one rep = from the start position to at least 80% of the
// learned rep and back. Full rep: short green flash. Turned back between 50% and
// 80%: short red flash, counted as a partial, not a rep.
// Moves that don't follow the learned rep are ignored (no flash): turning off its
// path by more than 60 deg (tilt), or tilting more than 35 deg away from the start
// position (height), as happens when swinging the arms while walking around.
//
// USB serial (115200) prints CSV at 50 Hz, integers only:
//   t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps,pos_milli,vz_mm_s,h_mm,reps,partials,state,mode
// accel in mg, gyro in 0.1 deg/s, pos = tilt position x1000 (0 at the start,
// 1000 at the far end of the learned rep), vz = vertical speed (mm/s, up
// positive), h = height (mm).
// state: 0 hold the start, 1 do the slow rep, 2 learned (green), 3 counting.
// mode: 0 none, 1 tilt, 2 height. Lines starting with '#' are events.
//
// Bluetooth LE, name "PerForm Band", service 8c1f0001-3b6e-4a6f-9b8e-5f0e2d7a4c10:
//   ...0002 reps    (read/notify, 10 bytes LE): uint16 reps, uint16 partials,
//                   uint8 mode, uint8 state, uint16 rom_mm, uint16 peak_speed_mm_s
//   ...0003 stream  (notify, 20 bytes LE, 25 Hz while subscribed): uint16 t_ms (wraps),
//                   int16 ax,ay,az (mg), int16 gx,gy,gz (0.1 deg/s), int16 pos*1000,
//                   int16 vz (mm/s), int16 h (mm)
//   ...0004 control (write, 1 byte): 'r' = learn a new exercise, 'n' = new set
//                   (counts back to 0, same exercise), 'w' = wipe the saved rep and learn again

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
// "Holding" tolerates a shaky hand: a real hand wobbles at 10-40 deg/s even
// when trying to keep still, while a real move turns and accelerates more.
const float HOLD_GYRO_DPS = 45.0;
const float HOLD_ACC_G = 0.08;
const unsigned long START_HOLD_MS = 1000;  // hold the start this long
const unsigned long END_HOLD_MS = 700;     // ...and again after the slow rep
const float MIN_ANGLE_DEG = 15.0;      // the learned rep must turn this much (tilt)...
const float MIN_HEIGHT_M = 0.05;       // ...or move this much (height)
const float TILT_OVER_HEIGHT_DEG = 25.0;   // from this angle tilt wins even if height moved a lot
const float BIG_HEIGHT_M = 0.10;       // below that angle, height wins from this distance
const float MAX_HEIGHT_M = 1.2;        // more than this is drift, not a real move
const float BACK_FRACTION = 0.3;       // back at the start: within this much of the way
// The learned rep must be slow: reaching its far end faster than this on average is a
// pick-up, not a rep (a real slow rep turned ~100 deg in 1.5-3 s, a pick-up 150 deg in a blink).
const float LEARN_MAX_RATE_DPS = 150.0;
const float OFF_PATH_DEG = 60.0;       // tilt: turning this far off the learned path
const float HEIGHT_TILT_DEG = 35.0;    // height: tilting this far from the start position
const float FULL_REP = 0.8;            // fraction of the learned rep for a rep
const float PARTIAL_REP = 0.5;         // ...and for a partial
const float POS_LEAVE = 0.35, POS_BACK = 0.3;  // tilt: left the start / nearly back at the start
// Tilt: once nearly back, the rep is counted where the arm stops (or turns into the
// next rep), not on the way down, so the flash comes at the start.
const float POS_HOME = 0.1;            // ...this close to the start counts as back
const float POS_TURN = 0.03;           // ...or turned this much back towards the far end
const float STOP_GYRO_DPS = 30.0;      // ...or turning slower than this
const float SPEED_GO = 0.10;           // m/s, a move has started
const float SPEED_END = 0.03;          // m/s, a move has ended
const float TWITCH_FRACTION = 0.2;     // height moves shorter than this are ignored
const int TUNE_REPS = 3;               // height: fine-tune the distance from this many first reps
const float TUNE_MIN = 0.6;            // ...that went at least this far
const float LEAK_PER_S = 1.0;          // pulls speed back to zero while moving
// While moving, the vertical acceleration carries a small offset (the gravity estimate
// is a few degrees off, the sensor's scale differs per axis), which integrates into a
// band that seems to rise for metres. Over a rep the real vertical acceleration
// averages to zero, so a slow running average of it is the offset: take it out.
const float BIAS_TAU_S = 1.0;   // replayed on the 2026-11-02 squat log: 5 full + 2 half, as done

enum State { LEARN_START, LEARN_REP, LEARNED, RUN };
enum Mode { NONE, TILT, HEIGHT };
State state = LEARN_START;
Mode mode = NONE;

float grav[3] = {0, 0, 1};       // gravity in board frame (g), tracked with the gyro
float gMag = 1.0;                // gravity magnitude as this sensor reads it at rest
float gyroBias[3] = {0, 0, 0};
float pt1[3], pt2[3], axisN[3];  // start position, far end of the learned rep (unit), tilt axis
float span = 1;                  // tilt angle start -> far end (rad)
float vz = 0, h = 0;             // vertical speed (m/s) and height (m)
float linBias = 0;               // offset in the vertical acceleration (m/s^2)
float calHeight = 0;             // height mode: learned distance (m)
float calMeasured = 0, tuneSum = 0;  // height: learned rep and first reps' legs
int tuned = TUNE_REPS;           // height: first reps used so far for fine-tuning
int legDir = 1;                  // height: +1 if a rep goes up first

unsigned long stillSince = 0, calmSince = 0, holdSince = 0, stateSince = 0, flashUntil = 0, lastUs = 0;
unsigned long lastSerial = 0, lastBle = 0;
bool flashRed = false;
int reps = 0, partials = 0;
bool offPath = false;            // this rep left the learned path: ignore it
float repOff = 0;                // furthest off the learned path in this rep (deg), logged
// Learning the slow rep
float maxAng = 0;                // furthest turned from the start (deg)
unsigned long learnMoveAt = 0, learnFarAt = 0;  // when the learned rep started turning / reached its far end
bool learnMoving = false;        // a height move is under way
float learnFromH = 0;            // ...and where it started
int legs = 0;                    // height legs of at least MIN_HEIGHT_M measured so far
float leg1 = 0, leg2 = 0;
int leg1Dir = 1;
// Counting
bool away = false;               // tilt: left the start in this rep
bool returning = false;          // tilt: nearly back, waiting for the arm to stop
float minPos = 0;                // tilt: closest to the start while returning
float maxReach = 0;              // tilt: furthest reached in this rep, as a fraction of the way
int phase = 0;                   // height: 0 resting, 1 first leg, 2 turning, 3 coming back
float moveStartH = 0, returnStartH = 0, towardRom = 0, repRom = 0, repPeak = 0;
float repMaxH = 0, repMinH = 0;  // height range in this rep, for the reported ROM
bool bleOk = false;

// Saved learned rep, so it survives unplugging.
struct Calibration {
  uint32_t magic;
  uint8_t mode;
  int8_t legDir;
  float pt1[3], pt2[3], axisN[3], span, calHeight;
};
const uint32_t CAL_MAGIC = 0x50464234;  // "PFB4"

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

// Signed angle from the start to the current gravity, around the learned axis,
// as a fraction of the learned rep's angle.
float tiltPosition() {
  float u[3] = { grav[0], grav[1], grav[2] };
  scaleTo(u, 1);
  float d = dot(u, axisN), ip[3] = { u[0] - d*axisN[0], u[1] - d*axisN[1], u[2] - d*axisN[2] };
  float c[3]; cross(pt1, ip, c);
  return atan2(dot(c, axisN), dot(pt1, ip)) / span;
}

// How far (deg) the band has turned off the plane the learned rep turns in.
float offPathDeg() {
  float u[3] = { grav[0], grav[1], grav[2] };
  scaleTo(u, 1);
  return asin(constrain(fabs(dot(u, axisN)), 0.0f, 1.0f)) * 180.0 / PI;
}

void printHeader() { Serial.println("t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps,pos_milli,vz_mm_s,h_mm,reps,partials,state,mode"); }

const char *modeName() {
  return mode == TILT ? "tilt" : mode == HEIGHT ? "height" : "none";
}

void saveCalibration() {
#ifdef HAVE_KV
  Calibration c = { CAL_MAGIC, (uint8_t)mode, (int8_t)legDir,
                    { pt1[0], pt1[1], pt1[2] }, { pt2[0], pt2[1], pt2[2] },
                    { axisN[0], axisN[1], axisN[2] }, span, calHeight };
  int err = kv_set("/kv/band_cal", &c, sizeof c, 0);
  Serial.println(err == 0 ? "# learned rep saved to flash" : "# could not save learned rep");
#else
  Serial.println("# no flash storage in this build, learned rep not saved");
#endif
}

void wipeCalibration() {
#ifdef HAVE_KV
  kv_remove("/kv/band_cal");
#endif
  Serial.println("# saved rep wiped");
}

bool loadCalibration() {
#ifdef HAVE_KV
  Calibration c;
  size_t got = 0;
  // Older builds saved two held points under another magic: those are ignored.
  if (kv_get("/kv/band_cal", &c, sizeof c, &got) != 0 || got != sizeof c || c.magic != CAL_MAGIC) return false;
  mode = (Mode)c.mode;
  legDir = c.legDir;
  for (int i = 0; i < 3; i++) { pt1[i] = c.pt1[i]; pt2[i] = c.pt2[i]; axisN[i] = c.axisN[i]; }
  span = c.span;
  calHeight = c.calHeight;
  tuned = TUNE_REPS;  // keep what was saved
  return (mode == TILT || mode == HEIGHT) && calHeight <= MAX_HEIGHT_M;
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

void startRep() {
  repPeak = 0;
  repMaxH = repMinH = h;
  offPath = false;
  repOff = 0;
}

// A new set: counts back to 0, same exercise.
void resetCounting() {
  reps = partials = 0;
  away = returning = offPath = false;
  phase = 0;
  repRom = repPeak = 0;
  h = repMaxH = repMinH = 0;
}

void startLearning() {
  resetCounting();
  mode = NONE;
  printHeader();
  Serial.println("# learn: get into the start position and hold it");
  enter(LEARN_START);
}

// fraction = how far this rep went, compared to the learned rep (1 = all the way).
void endRep(float fraction) {
  char line[112];
  if (offPath) {
    snprintf(line, sizeof line, "# ignored, off the learned path, reach_pct %ld off_deg %ld\r\n",
             lround(fraction * 100), lround(repOff));
    Serial.write(line, strlen(line));
    return;
  }
  bool full = fraction >= FULL_REP;
  if (!full && fraction < PARTIAL_REP) return;  // a small wobble, not a rep
  if (full) reps++; else partials++;
  flashRed = !full;
  flashUntil = millis() + 200;
  repRom = repMaxH - repMinH;
  snprintf(line, sizeof line, "# %s %d reach_pct %ld rom_mm %ld peak_mm_s %ld off_deg %ld\r\n",
           full ? "rep" : "partial", full ? reps : partials, lround(fraction * 100),
           lround(repRom * 1000), lround(repPeak * 1000), lround(repOff));
  Serial.write(line, strlen(line));
  publishReps();
}

// The slow rep is done: work out how to count this exercise.
void finishLearning() {
  float longest = max(leg1, leg2);
  bool tiltOk = maxAng >= MIN_ANGLE_DEG;
  bool heightOk = legs >= 2;
  if (tiltOk && (maxAng >= TILT_OVER_HEIGHT_DEG || !heightOk || longest < BIG_HEIGHT_M)) mode = TILT;
  else mode = HEIGHT;
  cross(pt1, pt2, axisN);
  scaleTo(axisN, 1);
  span = maxAng * DEG_TO_RAD;
  // Fast moves can read short in one direction, so take the longer leg (as for reps).
  calHeight = calMeasured = longest;
  tuneSum = 0;
  tuned = 0;
  legDir = leg1Dir;
  char line[112];
  snprintf(line, sizeof line, "# learned, mode %s, angle_deg %ld, height_mm %ld, first leg %s\r\n",
           modeName(), lround(maxAng), lround(longest * 1000), legDir > 0 ? "up" : "down");
  Serial.write(line, strlen(line));
  saveCalibration();
  enter(LEARNED);
}

void restartLearnRep(const char *why) {
  Serial.println(why);
  h = vz = 0;
  maxAng = 0;
  learnMoveAt = learnFarAt = 0;
  legs = 0;
  leg1 = leg2 = 0;
  learnMoving = false;
  for (int i = 0; i < 3; i++) pt2[i] = pt1[i];
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
    Serial.print("# loaded saved rep, mode "); Serial.println(modeName());
    enter(LEARNED);  // shows green, then starts counting
  } else {
    startLearning();
  }
  lastUs = micros();
}

// 'r' = learn a new exercise, 'n' = new set, 'w' = wipe the saved rep and learn again.
void command(int c) {
  if (c == 'w') wipeCalibration();
  if (c == 'r' || c == 'w') startLearning();
  if (c == 'n' && state == RUN) {
    resetCounting();
    startRep();
    Serial.println("# new set");
    publishReps();
  }
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
  unsigned long heldMs = holdSince ? now - holdSince : 0;

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
  // Still: whatever it reads is offset. Moving: follow it slowly, so reps cancel out.
  linBias += (lin - linBias) * (zupt ? 0.05f : DT / BIAS_TAU_S);
  lin -= linBias;
  if (zupt) vz = 0;
  // Less leak during the slow rep: a slow lift barely accelerates and the full leak
  // would eat part of it. Some leak is still needed, or a tiny offset drifts for metres.
  else vz += (lin - (state == LEARN_REP ? LEAK_PER_S / 2 : LEAK_PER_S) * vz) * DT;
  h += vz * DT;

  float pos = 0;
  bool blinkOn = (now / 200) % 2 == 0;
  switch (state) {
    case LEARN_START:
      led(false, false, blinkOn);  // blue blinking
      if (heldMs >= START_HOLD_MS) {
        for (int i = 0; i < 3; i++) pt1[i] = grav[i];
        scaleTo(pt1, 1);
        restartLearnRep("# start saved, now one slow full rep and back");
        enter(LEARN_REP);
      }
      break;
    case LEARN_REP: {
      led(true, false, true);  // solid purple
      float ang = angleDeg(grav, pt1);
      if (!learnMoveAt && ang > 5) learnMoveAt = now;
      if (ang > maxAng) {
        learnFarAt = now;
        maxAng = ang;
        for (int i = 0; i < 3; i++) pt2[i] = grav[i];
        scaleTo(pt2, 1);
      }
      // Each leg's length is read where the move ends (when the speed drops), the
      // same way a rep's leg is read, so learning and counting share the same errors.
      if (!learnMoving && fabs(vz) > SPEED_GO) { learnMoving = true; learnFromH = h; }
      else if (learnMoving && fabs(vz) < SPEED_END) {
        learnMoving = false;
        float leg = fabs(h - learnFromH);
        if (leg > MAX_HEIGHT_M) {
          // The height drifted (fast or big turning moves fool it): drop the height
          // legs but keep the tilt, which doesn't drift, so a curl still gets learned.
          Serial.println("# height not believable, using tilt only for this rep");
          h = vz = 0;
          legs = 0;
          leg1 = leg2 = 0;
          break;
        }
        if (leg >= MIN_HEIGHT_M) {
          legs++;
          if (legs == 1) { leg1 = leg; leg1Dir = h > learnFromH ? 1 : -1; }
          else if (legs == 2) leg2 = leg;
        }
      }
      // Done when back at the start and holding again, after a rep that turned or moved enough.
      bool back = ang < max(BACK_FRACTION * maxAng, 8.0f);
      bool enough = maxAng >= MIN_ANGLE_DEG || legs >= 2;
      if (back && enough && heldMs >= END_HOLD_MS) {
        float rate = learnMoveAt ? maxAng / max((learnFarAt - learnMoveAt) / 1000.0f, 0.05f) : 0;
        if (rate > LEARN_MAX_RATE_DPS) {
          // Too fast to be the slow rep (e.g. picking the band up): stay purple, try again.
          char line[80];
          snprintf(line, sizeof line, "# too fast (%ld deg/s), do the slow rep again\r\n", lround(rate));
          Serial.write(line, strlen(line));
          restartLearnRep("# waiting for the slow rep");
          holdSince = 0;
        } else finishLearning();
      }
      break;
    }
    case LEARNED:
      led(false, true, false);  // solid green
      if (now - stateSince > 1000) {
        h = vz = 0;
        enter(RUN);
        startRep();
        Serial.print("# ready, counting by "); Serial.println(modeName());
      }
      break;
    case RUN:
      if (fabs(vz) > repPeak) repPeak = fabs(vz);
      if (h > repMaxH) repMaxH = h;
      if (h < repMinH) repMinH = h;
      if (mode == TILT) {
        pos = tiltPosition();
        if (!away && pos > POS_LEAVE) { away = true; maxReach = pos; startRep(); }
        if (away) {
          if (pos > maxReach) maxReach = pos;
          float off = offPathDeg();
          if (off > repOff) repOff = off;
          if (off > OFF_PATH_DEG) offPath = true;
          if (!returning && pos < POS_BACK) { returning = true; minPos = pos; }
          if (returning) {
            if (pos < minPos) minPos = pos;
            if (pos < POS_HOME || pos > minPos + POS_TURN || norm(w) < STOP_GYRO_DPS) {
              away = returning = false;
              endRep(maxReach);
              // The arm is about stopped at the start: a good moment to clear the height
              // integration, which otherwise drifts over fast reps and spoils the ROM.
              vz = 0;
              h = 0;
            }
          }
        }
      } else {
        float v = vz * legDir;  // positive = the way the learned rep went first
        if (phase != 0) {
          float off = angleDeg(grav, pt1);
          if (off > repOff) repOff = off;
          if (off > HEIGHT_TILT_DEG) offPath = true;
        }
        switch (phase) {
          case 0:
            // Every rep starts the way the learned rep did, so the tail of a slow
            // return isn't taken for the start of a new rep.
            if (v > SPEED_GO) {
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
            // the band stops), so the flash comes at the start, not at the turn.
            float back = (returnStartH - h) * legDir;
            if ((v > -SPEED_END && back >= 0.5 * towardRom) || zupt) {
              // Fast moves can read short in one direction, so take the longer leg.
              phase = 0;
              float leg = max(towardRom, back);
              // One slow rep is often 10-20% off: average it with the first few
              // real reps, which are measured the same way.
              if (!offPath && tuned < TUNE_REPS && leg >= TUNE_MIN * calHeight) {
                tuneSum += leg;
                tuned++;
                calHeight = (calMeasured + tuneSum) / (1 + tuned);
                char line[64];
                snprintf(line, sizeof line, "# distance tuned, height_mm %ld\r\n", lround(calHeight * 1000));
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

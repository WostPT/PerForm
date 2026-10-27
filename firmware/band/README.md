# PerForm band firmware

Firmware for the rep-counting band: a Seeed XIAO nRF52840 Sense worn on the wrist or ankle.

## Setup (Windows, arduino-cli)

```powershell
arduino-cli config add board_manager.additional_urls https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
arduino-cli core update-index
arduino-cli core install Seeeduino:mbed
arduino-cli lib install "Seeed Arduino LSM6DS3" ArduinoBLE
arduino-cli compile --fqbn Seeeduino:mbed:xiaonRF52840Sense firmware/band/perform-band
arduino-cli upload  --fqbn Seeeduino:mbed:xiaonRF52840Sense -p COM6 firmware/band/perform-band
arduino-cli monitor -p COM6 --config baudrate=115200 > firmware/band/logs/band.csv
```

Don't name variables `p1`, `p2`…: those are pin macros in this core.
Logs in `logs/` are gitignored.

## perform-band (current)

Two-point calibration, then counts reps either by **tilt** (points ≥ 25° apart, e.g. a curl) or
by **height** (points ≥ 5 cm apart without tilting, e.g. a squat). Reads the IMU as fast as the
loop allows (target 200 Hz, integrating over the measured time step), prints integer CSV over USB
at 50 Hz, and advertises over Bluetooth LE as "PerForm Band" with a reps
characteristic (rep count, range of motion, peak speed) and an optional 25 Hz IMU stream.
The protocol is documented at the top of `perform-band.ino`.

LED: blue = hold still at the current point, green = point saved, then a red flash per rep in
tilt mode or a green flash per rep in height mode. Send `r` over serial or BLE to calibrate again.

## band-test (first experiment)

USB only, tilt mode only, 50 Hz. Kept for reference. First run on 2026-10-27: calibration
worked at 96°, 5 of 5 reps on the counted round, no false reps at rest.

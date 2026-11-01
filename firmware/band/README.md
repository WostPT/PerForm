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

## perform-band (current, v3)

Calibration designed by Miguel (2026-10-31), once per exercise, with the band on the table:

1. Blue blinking: go to point 1 and hold still; solid green for 1 s when saved.
2. Purple blinking: go to point 2 and hold still; solid green for 1 s when saved. Point 2 can
   differ in height (≥ 5 cm), tilt (≥ 15°) or both. The band counts by whichever changed more,
   or by tilt with height for range of motion when both changed a lot.
3. The calibration is saved in flash and loaded at power-up. Send `r` over USB or BLE to
   calibrate for a new exercise, or `w` to wipe the saved calibration first.

Counting, LED off: one rep = from point 1 to at least 80% of the way to point 2 and back (short
green flash). Turning back between 50% and 80% is a partial (short red flash), not a rep.

Reads the IMU as fast as the loop allows (target 200 Hz, integrating over the measured time
step), prints integer CSV over USB at 50 Hz, and advertises over Bluetooth LE as
"PerForm Band" with a reps characteristic (reps, partials, range of motion, peak speed) and an
optional 25 Hz IMU stream. The protocol is documented at the top of `perform-band.ino`.

## band-test (first experiment)

USB only, tilt mode only, 50 Hz. Kept for reference. First run on 2026-10-27: calibration
worked at 96°, 5 of 5 reps on the counted round, no false reps at rest.

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

## perform-band (current, v4)

Learns each exercise from one slow rep (Miguel, 2026-11-01), replacing v3's two held points:

1. Blue blinking: get into the start position of the exercise and hold it for 1 s.
2. Solid purple: do one slow, full rep, come back to the start and hold.
3. Solid green for 1 s: learned and saved on the chip, counting starts. It is loaded again at
   power-up. Send `r` over USB or BLE to learn a new exercise, `n` to start a new set (counts
   back to 0), or `w` to wipe the saved rep first.

The band counts by tilt when the learned rep turned at least 15°, otherwise by height when it
moved at least 5 cm (then the first 3 reps fine-tune the distance). Counting, LED off: one rep
= from the start to at least 80% of the learned rep and back (short green flash); turning back
between 50% and 80% is a partial (short red flash), not a rep. Moves off the learned path
(turning more than 60° off it in tilt mode, tilting more than 35° from the start in height
mode, e.g. arm swings while walking) are ignored.

Button between **D1** and **GND** (any two diagonal legs of the 6×6 switch): short press = new
set (blue flash), hold 2 s = learn a new exercise, hold 5 s = switch off (a press switches it on).
LiPo on the **BAT+ / BAT−** pads on the back, charged over USB-C; its level is printed every 30 s
and sent as the last byte of the reps characteristic.

`tools/replay.py` replays a USB log through a Python copy of learning and counting, to try a change
on recorded sets (`python firmware/band/tools/replay.py firmware/band/logs/<log>.csv`).

Reads the IMU as fast as the loop allows (target 200 Hz, integrating over the measured time
step), prints integer CSV over USB at 50 Hz, and advertises over Bluetooth LE as
"PerForm Band" with a reps characteristic (reps, partials, range of motion, peak speed) and an
optional 25 Hz IMU stream. The protocol is documented at the top of `perform-band.ino`.

## band-test (first experiment)

USB only, tilt mode only, 50 Hz. Kept for reference. First run on 2026-10-27: calibration
worked at 96°, 5 of 5 reps on the counted round, no false reps at rest.

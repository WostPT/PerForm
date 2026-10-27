# PerForm band firmware

Firmware for the rep-counting band: a Seeed XIAO nRF52840 Sense worn on the wrist or ankle.

## band-test (USB only)

First experiment, no battery and no button. Calibrates two points from the board's tilt and
counts reps between them, printing CSV over USB serial for analysis.

```powershell
arduino-cli config add board_manager.additional_urls https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
arduino-cli core update-index
arduino-cli core install Seeeduino:mbed
arduino-cli lib install "Seeed Arduino LSM6DS3"
arduino-cli compile --fqbn Seeeduino:mbed:xiaonRF52840Sense firmware/band/band-test
arduino-cli upload  --fqbn Seeeduino:mbed:xiaonRF52840Sense -p COM5 firmware/band/band-test
arduino-cli monitor -p COM5 --config baudrate=115200 > band-log.csv
```

LED: blue = hold still at the current point, green = point saved, red flash = one rep.
Send `r` over serial to calibrate again.

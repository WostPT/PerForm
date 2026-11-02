#!/usr/bin/env python3
"""Replay a band log (CSV from perform-band.ino) through a Python copy of the
firmware's learning and counting, to try changes without Miguel redoing a test.

    python replay.py logs/band-v4e-....csv            # current pipeline
    python replay.py logs/band-v4e-....csv --no-bias  # without the accel offset removal
    python replay.py logs/band-v4e-....csv --tau 1.5 --leak 0.5   # try other settings

It starts from the first '# learn:' line in the log (the band was told to learn
there), learns the slow rep the same way, then counts. The log is 50 Hz, the band
runs ~200 Hz, so numbers differ a little from the band's own '#' lines.
Prints the band's own events and the replayed ones side by side.
"""
import math
import sys

# Same constants as perform-band.ino
STILL_GYRO_DPS, STILL_ACC_G = 8.0, 0.03
ZUPT_GYRO_DPS, ZUPT_ACC_G, ZUPT_MS, STILL_ZUPT_MS = 4.0, 0.012, 150, 400
HOLD_GYRO_DPS, HOLD_ACC_G = 45.0, 0.08
START_HOLD_MS, END_HOLD_MS = 1000, 700
MIN_ANGLE_DEG, MIN_HEIGHT_M = 15.0, 0.05
TILT_OVER_HEIGHT_DEG, BIG_HEIGHT_M, MAX_HEIGHT_M = 25.0, 0.10, 1.2
BACK_FRACTION, LEARN_MAX_GYRO_DPS = 0.3, 300.0
OFF_PATH_DEG, HEIGHT_TILT_DEG = 60.0, 35.0
FULL_REP, PARTIAL_REP = 0.8, 0.5
POS_LEAVE, POS_BACK, POS_HOME, POS_TURN, STOP_GYRO_DPS = 0.35, 0.3, 0.1, 0.03, 30.0
SPEED_GO, SPEED_END, TWITCH_FRACTION = 0.10, 0.03, 0.2
TUNE_REPS, TUNE_MIN = 3, 0.6
LEAK_PER_S, BIAS_TAU_S = 0.2, 3.0
GRAV = 9.81


def dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def norm(v): return math.sqrt(dot(v, v))
def cross(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def unit(v):
    m = norm(v)
    return [x / m for x in v] if m > 1e-9 else list(v)
def angle_deg(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, dot(a, b) / (norm(a) * norm(b))))))


def load(path):
    rows, events = [], []
    for line in open(path, encoding='utf-8', errors='replace'):
        line = line.strip()
        if line.startswith('#'):
            events.append((rows[-1][0] if rows else 0, line))
            continue
        parts = line.split(',')
        if len(parts) != 14:
            continue
        try:
            rows.append([int(x) for x in parts])
        except ValueError:
            pass
    return rows, events


def replay(rows, events, use_bias=True, tau=None, leak=None):
    tau = BIAS_TAU_S if tau is None else tau
    leak = LEAK_PER_S if leak is None else leak
    start_t = next((t for t, e in events if e.startswith('# learn:')), None)
    if start_t is None:
        sys.exit('no "# learn:" line in this log')
    first = [r for r in rows if r[0] <= start_t][-50:] or rows[:50]
    grav = [sum(r[1+i] for r in first) / len(first) / 1000 for i in range(3)]
    gmag = norm(grav)
    gbias = [sum(r[4+i] for r in first) / len(first) / 10 for i in range(3)]
    if norm(gbias) > 15: gbias = [0, 0, 0]
    out = []
    st = {'state': 'LEARN_START', 'mode': None}
    vz = h = lin_bias = 0.0
    still_since = calm_since = hold_since = None
    last_t = None
    pt1 = pt2 = axis = None
    span = 1.0
    max_ang = peak_gyro = 0.0
    learn_moving = False; learn_from = 0.0; legs = []; leg_dirs = []
    cal_h = cal_meas = tune_sum = 0.0; tuned = 0; leg_dir = 1
    away = returning = off_path = False; max_reach = min_pos = rep_off = 0.0
    phase = 0; move_start = return_start = toward = 0.0
    reps = partials = 0
    peak_h = (0.0, 0.0)

    def end_rep(t, frac):
        nonlocal reps, partials
        if off_path:
            out.append((t, f'ignored, off path, reach_pct {frac*100:.0f} off_deg {rep_off:.0f}'))
            return
        if frac >= FULL_REP:
            reps += 1; out.append((t, f'rep {reps} reach_pct {frac*100:.0f}'))
        elif frac >= PARTIAL_REP:
            partials += 1; out.append((t, f'partial {partials} reach_pct {frac*100:.0f}'))

    for r in rows:
        t = r[0]
        if t < start_t:
            continue
        dt = 0.02 if last_t is None else min((t - last_t) / 1000, 0.1)
        last_t = t
        a = [r[1] / 1000, r[2] / 1000, r[3] / 1000]
        wraw = [r[4] / 10, r[5] / 10, r[6] / 10]
        w = [wraw[i] - gbias[i] for i in range(3)]
        amag, wn = norm(a), norm(w)
        gyro_still = wn < STILL_GYRO_DPS
        if gyro_still and abs(amag - gmag) < 0.15: gmag += 0.004 * (amag - gmag)  # x4: 50 Hz log
        still = gyro_still and abs(amag - gmag) < STILL_ACC_G
        still_since = (still_since or t) if still else None
        calm = wn < ZUPT_GYRO_DPS and abs(amag - gmag) < ZUPT_ACC_G
        calm_since = (calm_since or t) if calm else None
        zupt = (calm_since is not None and t - calm_since >= ZUPT_MS) or \
               (still_since is not None and t - still_since >= STILL_ZUPT_MS)
        holding = wn < HOLD_GYRO_DPS and abs(amag - gmag) < HOLD_ACC_G
        hold_since = (hold_since or t) if holding else None
        held = t - hold_since if hold_since is not None else 0
        om = [math.radians(x) for x in w]
        c = cross(om, grav)
        grav = [grav[i] - c[i] * dt for i in range(3)]
        k = 0.2 if still else (0.02 if abs(amag - gmag) < 0.1 else 0)  # x4: 50 Hz log
        grav = [grav[i] + k * (a[i] - grav[i]) for i in range(3)]
        if still: gbias = [gbias[i] + 0.04 * (wraw[i] - gbias[i]) for i in range(3)]
        grav = [x * gmag / norm(grav) for x in grav]
        lin = (dot(a, grav) / gmag - gmag) * GRAV
        if use_bias:
            lin_bias += (lin - lin_bias) * (0.2 if zupt else dt / tau)
            lin -= lin_bias
        if zupt: vz = 0.0
        else: vz += (lin - (leak / 2 if st['state'] == 'LEARN_REP' else leak) * vz) * dt
        h += vz * dt
        peak_h = (max(peak_h[0], h), min(peak_h[1], h))
        g_unit = unit(grav)

        if st['state'] == 'LEARN_START':
            if held >= START_HOLD_MS:
                pt1 = g_unit; pt2 = g_unit
                h = vz = 0.0; max_ang = peak_gyro = 0.0; legs, leg_dirs = [], []; learn_moving = False
                st['state'] = 'LEARN_REP'; hold_since = None
                out.append((t, 'start saved'))
        elif st['state'] == 'LEARN_REP':
            ang = angle_deg(grav, pt1)
            peak_gyro = max(peak_gyro, wn)
            if ang > max_ang: max_ang, pt2 = ang, g_unit
            if not learn_moving and abs(vz) > SPEED_GO:
                learn_moving, learn_from = True, h
            elif learn_moving and abs(vz) < SPEED_END:
                learn_moving = False
                leg = abs(h - learn_from)
                if leg > MAX_HEIGHT_M:
                    out.append((t, 'height not believable, tilt only'))
                    h = vz = 0.0; legs, leg_dirs = [], []
                elif leg >= MIN_HEIGHT_M:
                    legs.append(leg); leg_dirs.append(1 if h > learn_from else -1)
            back = ang < max(BACK_FRACTION * max_ang, 8.0)
            enough = max_ang >= MIN_ANGLE_DEG or len(legs) >= 2
            if back and enough and held >= END_HOLD_MS:
                if peak_gyro > LEARN_MAX_GYRO_DPS:
                    out.append((t, f'too fast ({peak_gyro:.0f} deg/s), again'))
                    h = vz = 0.0; max_ang = peak_gyro = 0.0; legs, leg_dirs = [], []; hold_since = None
                    continue
                longest = max(legs[:2]) if legs else 0.0
                height_ok = len(legs) >= 2
                tilt_ok = max_ang >= MIN_ANGLE_DEG
                st['mode'] = 'tilt' if tilt_ok and (max_ang >= TILT_OVER_HEIGHT_DEG or not height_ok or longest < BIG_HEIGHT_M) else 'height'
                axis = unit(cross(pt1, pt2)); span = math.radians(max_ang)
                cal_h = cal_meas = longest; tune_sum = 0.0; tuned = 0
                leg_dir = leg_dirs[0] if leg_dirs else 1
                out.append((t, f'learned, mode {st["mode"]}, angle_deg {max_ang:.0f}, height_mm {longest*1000:.0f}, first leg {"up" if leg_dir > 0 else "down"}'))
                st['state'] = 'RUN'; h = vz = 0.0
        elif st['state'] == 'RUN':
            if st['mode'] == 'tilt':
                d = dot(g_unit, axis)
                ip = [g_unit[i] - d * axis[i] for i in range(3)]
                pos = math.atan2(dot(cross(pt1, ip), axis), dot(pt1, ip)) / span
                if not away and pos > POS_LEAVE:
                    away, max_reach, off_path, rep_off = True, pos, False, 0.0
                if away:
                    max_reach = max(max_reach, pos)
                    off = math.degrees(math.asin(min(1.0, abs(d))))
                    rep_off = max(rep_off, off)
                    if off > OFF_PATH_DEG: off_path = True
                    if not returning and pos < POS_BACK: returning, min_pos = True, pos
                    if returning:
                        min_pos = min(min_pos, pos)
                        if pos < POS_HOME or pos > min_pos + POS_TURN or wn < STOP_GYRO_DPS:
                            away = returning = False
                            end_rep(t, max_reach)
                            vz = h = 0.0
            else:
                v = vz * leg_dir
                if phase != 0:
                    off = angle_deg(grav, pt1); rep_off = max(rep_off, off)
                    if off > HEIGHT_TILT_DEG: off_path = True
                if phase == 0:
                    if v > SPEED_GO:
                        phase, move_start, off_path, rep_off = 1, h, False, 0.0
                elif phase == 1:
                    if v < SPEED_END:
                        toward = (h - move_start) * leg_dir
                        if toward < TWITCH_FRACTION * cal_h: phase = 0
                        else: phase, return_start = (3 if v < -SPEED_GO else 2), h
                elif phase == 2:
                    if v < -SPEED_GO: phase, return_start = 3, h
                    elif v > SPEED_GO: phase = 1
                elif phase == 3:
                    back = (return_start - h) * leg_dir
                    if (v > -SPEED_END and back >= 0.5 * toward) or zupt:
                        phase = 0
                        leg = max(toward, back)
                        if not off_path and tuned < TUNE_REPS and leg >= TUNE_MIN * cal_h:
                            tune_sum += leg; tuned += 1
                            cal_h = (cal_meas + tune_sum) / (1 + tuned)
                            out.append((t, f'distance tuned, height_mm {cal_h*1000:.0f}'))
                        end_rep(t, leg / cal_h)
    return out, peak_h


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rows, events = load(sys.argv[1])
    use_bias = '--no-bias' not in sys.argv
    def arg(name):
        return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else None
    tau, leak = arg('--tau'), arg('--leak')
    out, peak_h = replay(rows, events, use_bias, tau, leak)
    print(f'rows {len(rows)}, offset removal {"on" if use_bias else "off"}, tau {tau or BIAS_TAU_S}, leak {leak or LEAK_PER_S}, '
          f'height range {peak_h[1]*1000:.0f}..{peak_h[0]*1000:.0f} mm')
    print('--- band events')
    for t, e in events:
        print(f'{t/1000:9.1f}  {e}')
    print('--- replayed')
    for t, e in out:
        print(f'{t/1000:9.1f}  {e}')


if __name__ == '__main__':
    main()

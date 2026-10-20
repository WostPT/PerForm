package ch.duartesantos.opengym;

import android.content.Intent;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.HealthConnectFeatures;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.aggregate.AggregateMetric;
import androidx.health.connect.client.aggregate.AggregationResult;
import androidx.health.connect.client.aggregate.AggregationResultGroupedByPeriod;
import androidx.health.connect.client.records.DistanceRecord;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.RestingHeartRateRecord;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest;
import androidx.health.connect.client.request.AggregateRequest;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.units.Length;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.Period;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;

/**
 * PerForm: reads what a watch (a Fitbit Versa 4, through the Fitbit app) puts into Health Connect:
 * sleep, heart rate, resting heart rate, HRV, steps, workouts and weigh-ins. The other half of
 * HealthConnectPlugin, which only writes; kept in a file of its own so that one stays as upstream
 * has it. Off until the user turns it on in Settings, and nothing is asked for before that.
 *
 * This side only fetches. Days come back already summed (steps, heart rate min/avg/max, resting
 * heart rate), since a day of heart-rate samples is thousands of points; sleep, HRV, workouts and
 * weigh-ins come back as records. What they mean, and how they fold into the log, is worked out
 * in JS (lib/perform-health.js). Records this app wrote itself are left out.
 *
 * Each data type is read only when its permission was granted: the user can allow sleep and not
 * heart rate, and the rest still comes through.
 *
 * Usage from JS (lib/perform-health-read.js):
 *   const HR = registerPlugin('HealthRead');
 *   await HR.status();              // { status, granted: ['sleep', …], history }
 *   await HR.requestPermissions();  // { granted: ['sleep', …] }
 *   await HR.read({ since, until }); // { days, sleep, hrv, sessions, weights }
 */
@CapacitorPlugin(name = "HealthRead")
public class HealthReadPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";
    private static final String P = "android.permission.health.";
    // The short names JS knows each permission by, and the literal names in AndroidManifest.xml.
    private static final Map<String, String> PERMISSIONS = new LinkedHashMap<>();
    static {
        PERMISSIONS.put("sleep", P + "READ_SLEEP");
        PERMISSIONS.put("heart", P + "READ_HEART_RATE");
        PERMISSIONS.put("rhr", P + "READ_RESTING_HEART_RATE");
        PERMISSIONS.put("hrv", P + "READ_HEART_RATE_VARIABILITY");
        PERMISSIONS.put("steps", P + "READ_STEPS");
        PERMISSIONS.put("distance", P + "READ_DISTANCE");
        PERMISSIONS.put("exercise", P + "READ_EXERCISE");
        PERMISSIONS.put("weight", P + "READ_WEIGHT");
    }
    // Without it Health Connect hands out only the 30 days before the first permission was granted.
    private static final String HISTORY = P + "READ_HEALTH_DATA_HISTORY";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private boolean available() {
        return supported() && HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER) == HealthConnectClient.SDK_AVAILABLE;
    }

    private HealthConnectClient client() {
        return HealthConnectClient.Companion.getOrCreate(getContext(), PROVIDER);
    }

    // Older Health Connect builds do not know the history permission; asking for it there is
    // pointless, so it is only asked for where the feature is there.
    private boolean historyFeature() {
        try {
            return client().getFeatures().getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)
                    == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE;
        } catch (Throwable e) {
            return false;
        }
    }

    private Set<String> asked() {
        Set<String> p = new HashSet<>(PERMISSIONS.values());
        if (historyFeature()) p.add(HISTORY);
        return p;
    }

    @SuppressWarnings("unchecked")
    private Set<String> granted() throws InterruptedException {
        PermissionController pc = client().getPermissionController();
        return (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> pc.getGrantedPermissions(cont));
    }

    private static JSArray names(Set<String> granted) {
        JSArray out = new JSArray();
        for (Map.Entry<String, String> e : PERMISSIONS.entrySet()) if (granted.contains(e.getValue())) out.put(e.getKey());
        return out;
    }

    @PluginMethod
    public void status(PluginCall call) {
        if (!available()) {
            JSObject r = new JSObject();
            r.put("status", supported() ? "missing" : "unsupported");
            r.put("granted", new JSArray());
            r.put("history", false);
            call.resolve(r);
            return;
        }
        worker.execute(() -> {
            try {
                Set<String> g = granted();
                JSObject r = new JSObject();
                r.put("status", "available");
                r.put("granted", names(g));
                r.put("history", g.contains(HISTORY));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!available()) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), asked());
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        // What stands now, not what this one dialog said: some may have been granted before.
        worker.execute(() -> {
            try {
                Set<String> g = granted();
                JSObject r = new JSObject();
                r.put("granted", names(g));
                r.put("history", g.contains(HISTORY));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        if (!available()) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        // optLong takes the number whichever way the bridge typed it (int, long or double).
        long sinceMs = call.getData().optLong("since", 0);
        long untilMs = call.getData().optLong("until", 0);
        if (sinceMs <= 0 || untilMs <= sinceMs) {
            call.reject("since and until are required", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                Set<String> g = granted();
                Instant since = Instant.ofEpochMilli(sinceMs), until = Instant.ofEpochMilli(untilMs);
                String own = getContext().getPackageName();
                JSObject r = new JSObject();
                r.put("days", days(g, since, until));
                r.put("sleep", g.contains(PERMISSIONS.get("sleep")) ? sleep(since, until, own) : new JSArray());
                r.put("hrv", g.contains(PERMISSIONS.get("hrv")) ? hrv(since, until, own) : new JSArray());
                r.put("sessions", g.contains(PERMISSIONS.get("exercise")) ? sessions(g, since, until, own) : new JSArray());
                r.put("weights", g.contains(PERMISSIONS.get("weight")) ? weights(since, until, own) : new JSArray());
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @SuppressWarnings("unchecked")
    private <T extends Record> List<T> readAll(Class<T> type, Instant from, Instant to) throws InterruptedException {
        List<T> out = new ArrayList<>();
        String token = null;
        do {
            ReadRecordsRequest<T> req = new ReadRecordsRequest<>(JvmClassMappingKt.getKotlinClass(type),
                    TimeRangeFilter.between(from, to), Collections.emptySet(), true, 1000, token);
            ReadRecordsResponse<T> res = (ReadRecordsResponse<T>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                    (scope, cont) -> client().readRecords(req, cont));
            out.addAll(res.getRecords());
            token = res.getPageToken();
        } while (token != null && !token.isEmpty());
        return out;
    }

    private static String origin(Metadata m) {
        return m.getDataOrigin().getPackageName();
    }

    // Steps and heart rate summed per local calendar day, from the start of the day `since` falls
    // on: a day read from its middle would come back short.
    private JSArray days(Set<String> g, Instant since, Instant until) throws InterruptedException {
        Set<AggregateMetric<?>> metrics = new HashSet<>();
        boolean steps = g.contains(PERMISSIONS.get("steps"));
        boolean heart = g.contains(PERMISSIONS.get("heart"));
        boolean rhr = g.contains(PERMISSIONS.get("rhr"));
        if (steps) metrics.add(StepsRecord.COUNT_TOTAL);
        if (heart) { metrics.add(HeartRateRecord.BPM_MIN); metrics.add(HeartRateRecord.BPM_AVG); metrics.add(HeartRateRecord.BPM_MAX); }
        if (rhr) metrics.add(RestingHeartRateRecord.BPM_AVG);
        JSArray out = new JSArray();
        if (metrics.isEmpty()) return out;
        ZoneId zone = ZoneId.systemDefault();
        LocalDateTime from = since.atZone(zone).toLocalDate().atStartOfDay();
        LocalDateTime to = until.atZone(zone).toLocalDate().plusDays(1).atStartOfDay();
        AggregateGroupByPeriodRequest req = new AggregateGroupByPeriodRequest(metrics,
                TimeRangeFilter.between(from, to), Period.ofDays(1), Collections.emptySet());
        @SuppressWarnings("unchecked")
        List<AggregationResultGroupedByPeriod> rows = (List<AggregationResultGroupedByPeriod>) BuildersKt.runBlocking(
                EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().aggregateGroupByPeriod(req, cont));
        for (AggregationResultGroupedByPeriod row : rows) {
            AggregationResult a = row.getResult();
            JSObject d = new JSObject();
            d.put("d", row.getStartTime().toLocalDate().toString());
            if (steps) putLong(d, "steps", a.get(StepsRecord.COUNT_TOTAL));
            if (heart) {
                putLong(d, "hrMin", a.get(HeartRateRecord.BPM_MIN));
                putLong(d, "hrAvg", a.get(HeartRateRecord.BPM_AVG));
                putLong(d, "hrMax", a.get(HeartRateRecord.BPM_MAX));
            }
            if (rhr) putLong(d, "rhr", a.get(RestingHeartRateRecord.BPM_AVG));
            out.put(d);
        }
        return out;
    }

    private static void putLong(JSObject o, String key, Long v) {
        if (v != null) o.put(key, (long) v);
    }

    private JSArray sleep(Instant since, Instant until, String own) throws InterruptedException {
        JSArray out = new JSArray();
        for (SleepSessionRecord s : readAll(SleepSessionRecord.class, since, until)) {
            if (own.equals(origin(s.getMetadata()))) continue;
            JSObject o = new JSObject();
            o.put("id", s.getMetadata().getId());
            o.put("start", s.getStartTime().toEpochMilli());
            o.put("end", s.getEndTime().toEpochMilli());
            o.put("src", origin(s.getMetadata()));
            JSArray stages = new JSArray();
            for (SleepSessionRecord.Stage st : s.getStages()) {
                JSObject x = new JSObject();
                x.put("s", st.getStartTime().toEpochMilli());
                x.put("e", st.getEndTime().toEpochMilli());
                x.put("k", st.getStage());
                stages.put(x);
            }
            o.put("stages", stages);
            out.put(o);
        }
        return out;
    }

    private JSArray hrv(Instant since, Instant until, String own) throws InterruptedException {
        JSArray out = new JSArray();
        for (HeartRateVariabilityRmssdRecord h : readAll(HeartRateVariabilityRmssdRecord.class, since, until)) {
            if (own.equals(origin(h.getMetadata()))) continue;
            JSObject o = new JSObject();
            o.put("time", h.getTime().toEpochMilli());
            o.put("ms", h.getHeartRateVariabilityMillis());
            out.put(o);
        }
        return out;
    }

    // Workouts recorded elsewhere (the watch), each with its heart rate, steps and distance over
    // its own time span. The ones this app wrote are its own workouts and are already in the log.
    private JSArray sessions(Set<String> g, Instant since, Instant until, String own) throws InterruptedException {
        Set<AggregateMetric<?>> metrics = new HashSet<>();
        boolean heart = g.contains(PERMISSIONS.get("heart"));
        boolean steps = g.contains(PERMISSIONS.get("steps"));
        boolean distance = g.contains(PERMISSIONS.get("distance"));
        if (heart) { metrics.add(HeartRateRecord.BPM_AVG); metrics.add(HeartRateRecord.BPM_MAX); }
        if (steps) metrics.add(StepsRecord.COUNT_TOTAL);
        if (distance) metrics.add(DistanceRecord.DISTANCE_TOTAL);
        JSArray out = new JSArray();
        for (ExerciseSessionRecord s : readAll(ExerciseSessionRecord.class, since, until)) {
            if (own.equals(origin(s.getMetadata()))) continue;
            JSObject o = new JSObject();
            o.put("id", s.getMetadata().getId());
            o.put("start", s.getStartTime().toEpochMilli());
            o.put("end", s.getEndTime().toEpochMilli());
            o.put("type", s.getExerciseType());
            if (s.getTitle() != null) o.put("title", s.getTitle());
            o.put("src", origin(s.getMetadata()));
            if (!metrics.isEmpty()) {
                AggregateRequest req = new AggregateRequest(metrics,
                        TimeRangeFilter.between(s.getStartTime(), s.getEndTime()), Collections.emptySet());
                AggregationResult a = (AggregationResult) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                        (scope, cont) -> client().aggregate(req, cont));
                if (heart) {
                    putLong(o, "hrAvg", a.get(HeartRateRecord.BPM_AVG));
                    putLong(o, "hrMax", a.get(HeartRateRecord.BPM_MAX));
                }
                if (steps) putLong(o, "steps", a.get(StepsRecord.COUNT_TOTAL));
                if (distance) {
                    Length m = a.get(DistanceRecord.DISTANCE_TOTAL);
                    if (m != null) o.put("m", m.getMeters());
                }
            }
            out.put(o);
        }
        return out;
    }

    private JSArray weights(Instant since, Instant until, String own) throws InterruptedException {
        JSArray out = new JSArray();
        for (WeightRecord w : readAll(WeightRecord.class, since, until)) {
            if (own.equals(origin(w.getMetadata()))) continue;
            JSObject o = new JSObject();
            o.put("id", w.getMetadata().getId());
            o.put("time", w.getTime().toEpochMilli());
            o.put("kg", w.getWeight().getKilograms());
            o.put("src", origin(w.getMetadata()));
            out.put(o);
        }
        return out;
    }
}

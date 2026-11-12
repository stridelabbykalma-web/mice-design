// MICE Scan — app de las gafas (Meta Quest 3 / 3S) para MICE Design.
//
// Escanea la sala caminando: lanza rayos contra el mapa de profundidad de las gafas, acumula
// en una rejilla de 10 cm el suelo visto, las paredes y lo que ocupa sitio, y al terminar
// sube el resultado y muestra un código de 6 cifras. En la web (panel Espacio → «Escaneo de
// la app de las gafas») se escribe ese código y la sala aparece con sus muebles.
// La planta se reconstruye en la web (src/lib/walkScan.ts): aquí solo se recogen los datos.
//
// Uso en Unity: escena con los bloques «Camera Rig», «Passthrough» y «Occlusion»; crear un
// objeto vacío y añadirle este script.
//
// Mandos:  gatillo = terminar y subir · B o Y = empezar de nuevo · A o X = mostrar/ocultar puntos

using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
using Meta.XR.MRUtilityKit;
using Meta.XR.EnvironmentDepth;

public class MiceScan : MonoBehaviour
{
    const string SupabaseUrl = "https://czpzvcrwejkgtwsvgxpr.supabase.co";
    const string SupabaseKey = "sb_publishable_r50ep5iXZrEVUyLnc1ckXQ_67LcGFio";

    const float Cell = 0.1f;        // tamaño de celda (m)
    const float MaxRange = 5f;      // la profundidad pierde precisión más lejos
    const int MinFrames = 3;        // lecturas distintas para dar una celda por buena
    const int Cols = 20, Rows = 14; // rayos por lectura
    const float Interval = 0.12f;   // segundos entre lecturas

    EnvironmentRaycastManager raycaster;
    Transform head;
    TextMesh label;
    ParticleSystem dots;
    float nextRead;
    bool uploading;
    string status = "";
    Vector3 lastPos;
    Quaternion lastRot;
    int still;

    // Rejillas (clave = celda)
    readonly Dictionary<long, int> free = new Dictionary<long, int>();
    readonly Dictionary<long, int> wall = new Dictionary<long, int>();
    readonly Dictionary<long, int> obj = new Dictionary<long, int>();
    readonly Dictionary<long, float> objH = new Dictionary<long, float>();
    readonly Dictionary<int, int> ceil = new Dictionary<int, int>();
    readonly List<Vector2> path = new List<Vector2>();
    readonly HashSet<long> painted = new HashSet<long>();
    int frames;

    static long Key(int ix, int iz) { return ((long)(ix + 100000) << 32) | (uint)(iz + 100000); }
    static int KeyX(long k) { return (int)(k >> 32) - 100000; }
    static int KeyZ(long k) { return (int)(k & 0xffffffff) - 100000; }

    // Si el componente no se añadió a ningún objeto de la escena, se crea solo al arrancar.
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Bootstrap()
    {
        if (FindFirstObjectByType<MiceScan>() == null) new GameObject("MiceScan (auto)").AddComponent<MiceScan>();
    }

    // ---- Diagnóstico: lo que pasa en las gafas se envía al servidor para poder revisarlo ----
    readonly List<string> log = new List<string>();
    int logSent;
    float nextLog = 6f;
    int rayHits, rayTotal;

    void Note(string m) { if (log.Count < 200) log.Add(Time.time.ToString("0.0", CultureInfo.InvariantCulture) + " " + m); }
    void OnLog(string msg, string stack, LogType type)
    {
        if (type == LogType.Error || type == LogType.Exception || type == LogType.Assert)
            Note("[" + type + "] " + msg + " | " + (stack ?? "").Replace("\n", " / "));
    }
    void OnEnable() { Application.logMessageReceived += OnLog; }
    void OnDisable() { Application.logMessageReceived -= OnLog; }

    static string Esc(string t) { return t.Replace("\\", "/").Replace("\"", "'").Replace("\n", " ").Replace("\r", " ").Replace("\t", " "); }

    IEnumerator SendLog()
    {
        var sb = new StringBuilder("{\"p_data\":{\"format\":\"mice-roomplan\",\"version\":2,\"walls\":[],\"diag\":true,\"log\":[");
        for (int i = 0; i < log.Count; i++) { if (i > 0) sb.Append(','); sb.Append('"').Append(Esc(log[i])).Append('"'); }
        sb.Append("]}}");
        logSent = log.Count;
        using (var req = new UnityWebRequest(SupabaseUrl + "/rest/v1/rpc/scan_drop", "POST"))
        {
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(sb.ToString()));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.SetRequestHeader("apikey", SupabaseKey);
            req.SetRequestHeader("Authorization", "Bearer " + SupabaseKey);
            yield return req.SendWebRequest();
        }
    }

    void Start()
    {
        Note("MiceScan v2 · Unity " + Application.unityVersion + " · " + SystemInfo.deviceModel + " · " + SystemInfo.graphicsDeviceType);
        try
        {
            var rig = FindFirstObjectByType<OVRCameraRig>();
            head = rig != null ? rig.centerEyeAnchor : (Camera.main != null ? Camera.main.transform : null);
            Note("cabeza: " + (rig != null ? "OVRCameraRig" : head != null ? "Camera.main" : "NINGUNA"));
        }
        catch (System.Exception e) { Note("ERROR cabeza: " + e.Message); }

        // Permiso de datos de la sala (lo pide el mapa de profundidad); sale un aviso la primera vez
#if UNITY_ANDROID && !UNITY_EDITOR
        try
        {
            const string scenePermission = "com.oculus.permission.USE_SCENE";
            bool ok = UnityEngine.Android.Permission.HasUserAuthorizedPermission(scenePermission);
            Note("permiso de sala: " + ok);
            if (!ok) UnityEngine.Android.Permission.RequestUserPermission(scenePermission);
        }
        catch (System.Exception e) { Note("ERROR permiso: " + e.Message); }
#endif
        try
        {
            // Mapa de profundidad: si la escena no tiene el bloque Occlusion, se activa aquí
            var depth = FindFirstObjectByType<EnvironmentDepthManager>();
            Note("EnvironmentDepthManager en la escena: " + (depth != null));
            if (depth == null) depth = gameObject.AddComponent<EnvironmentDepthManager>();
            depth.enabled = true;
        }
        catch (System.Exception e) { Note("ERROR profundidad: " + e.Message); }
        try
        {
            raycaster = FindFirstObjectByType<EnvironmentRaycastManager>();
            Note("EnvironmentRaycastManager en la escena: " + (raycaster != null) + " · admitido: " + EnvironmentRaycastManager.IsSupported);
            if (raycaster == null) raycaster = gameObject.AddComponent<EnvironmentRaycastManager>();
        }
        catch (System.Exception e) { Note("ERROR rayos: " + e.Message); }

        // Texto que sigue a la mirada
        try
        {
            var go = new GameObject("MiceScanTexto");
            label = go.AddComponent<TextMesh>();
            Font font = null;
            try { font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); } catch (System.Exception) { }
            if (font == null)
            {
                var names = Font.GetOSInstalledFontNames();
                Note("fuente incorporada no disponible; fuentes del sistema: " + names.Length);
                font = Font.CreateDynamicFontFromOSFont(names.Length > 0 ? names[0] : "Roboto", 60);
            }
            label.font = font;
            var mr = go.GetComponent<MeshRenderer>();
            mr.material = font.material;
            Note("texto: fuente " + font.name + " · shader " + (mr.material != null && mr.material.shader != null ? mr.material.shader.name : "NINGUNO"));
            label.fontSize = 60;
            label.characterSize = 0.012f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = Color.white;
        }
        catch (System.Exception e) { Note("ERROR texto: " + e.Message); }

        // Puntos verdes donde se han visto paredes y muebles
        try
        {
            var pgo = new GameObject("MiceScanPuntos");
            dots = pgo.AddComponent<ParticleSystem>();
            dots.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = dots.main;
            main.loop = false;
            main.playOnAwake = false;
            main.maxParticles = 30000;
            main.startLifetime = 100000f;
            main.startSpeed = 0f;
            main.startSize = 0.04f;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var em = dots.emission; em.enabled = false;
            var sh = dots.shape; sh.enabled = false;
            Shader shader = null;
            foreach (var n in new[] { "Universal Render Pipeline/Particles/Unlit", "Universal Render Pipeline/Unlit", "Sprites/Default", "Unlit/Color" })
            {
                shader = Shader.Find(n);
                if (shader != null) { Note("puntos: shader " + n); break; }
            }
            if (shader == null) Note("puntos: NINGÚN shader disponible");
            else pgo.GetComponent<ParticleSystemRenderer>().material = new Material(shader);
        }
        catch (System.Exception e) { Note("ERROR puntos: " + e.Message); }

        ResetScan();
    }

    void ResetScan()
    {
        free.Clear(); wall.Clear(); obj.Clear(); objH.Clear(); ceil.Clear(); path.Clear(); painted.Clear();
        frames = 0;
        if (dots != null) dots.Clear();
        status = "";
    }

    void Update()
    {
        // Diagnóstico al servidor: a los 6 s y luego cada 15 s mientras haya líneas nuevas (2 primeros minutos)
        if (Time.time > nextLog && Time.time < 130f)
        {
            nextLog = Time.time + 15f;
            Note("estado: lecturas " + frames + " · rayos con impacto " + rayHits + "/" + rayTotal + " · suelo " + free.Count + " · pared " + wall.Count + " · quieta " + still);
            if (log.Count > logSent) StartCoroutine(SendLog());
        }
        if (head == null || label == null) return;

        // El texto, a 1,3 m delante y algo por debajo de los ojos
        var fwd = head.forward; fwd.y = 0;
        if (fwd.sqrMagnitude < 0.01f) fwd = Vector3.forward;
        fwd.Normalize();
        var target = head.position + fwd * 1.3f + Vector3.down * 0.25f;
        label.transform.position = Vector3.Lerp(label.transform.position, target, 0.1f);
        label.transform.rotation = Quaternion.LookRotation(label.transform.position - head.position);
        label.text = Message();

        if (uploading) return;

        if (OVRInput.GetDown(OVRInput.Button.Two) || OVRInput.GetDown(OVRInput.Button.Four)) ResetScan();
        if (dots != null && (OVRInput.GetDown(OVRInput.Button.One) || OVRInput.GetDown(OVRInput.Button.Three)))
            dots.gameObject.SetActive(!dots.gameObject.activeSelf);
        if (OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger) || OVRInput.GetDown(OVRInput.Button.SecondaryIndexTrigger))
        {
            if (wall.Count > 40) StartCoroutine(Upload());
            else status = "Todavía hay pocas paredes vistas: sigue caminando";
        }

        // Con la cabeza moviéndose deprisa la profundidad va por detrás: se espera
        float ang = Quaternion.Angle(lastRot, head.rotation);
        float dist = Vector3.Distance(lastPos, head.position);
        lastRot = head.rotation; lastPos = head.position;
        still = (ang > 2.5f || dist > 0.04f) ? 0 : still + 1;

        if (Time.time < nextRead || still < 3) return;
        nextRead = Time.time + Interval;
        if (raycaster == null || !EnvironmentRaycastManager.IsSupported) { status = "Estas gafas no dan el mapa de profundidad"; return; }
        ReadFrame();
    }

    string Message()
    {
        if (uploading) return status;
        float m2 = 0;
        foreach (var kv in free) if (kv.Value >= MinFrames) m2 += Cell * Cell;
        int walls = 0;
        foreach (var kv in wall) if (kv.Value >= MinFrames) walls++;
        string s = "MICE Scan — camina por toda la sala mirando a las paredes\n"
                 + "Suelo visto: " + m2.ToString("0") + " m2 · paredes: " + (walls * Cell).ToString("0") + " m\n"
                 + "Gatillo: terminar y subir · B/Y: empezar de nuevo · A/X: puntos";
        return status.Length > 0 ? s + "\n" + status : s;
    }

    /// Una lectura: rejilla de rayos desde la cabeza contra el mapa de profundidad.
    void ReadFrame()
    {
        frames++;
        Vector3 hp = head.position;
        // Coordenadas de la web: mismo x e y, z cambiada de signo (Unity es de mano izquierda)
        float hx = hp.x, hz = -hp.z, hy = hp.y;
        if (path.Count == 0 || Vector2.Distance(path[path.Count - 1], new Vector2(hx, hz)) > 0.3f) path.Add(new Vector2(hx, hz));

        var seenFree = new HashSet<long>();
        var seenWall = new HashSet<long>();
        var seenObj = new HashSet<long>();

        for (int r = 0; r < Rows; r++)
        for (int c = 0; c < Cols; c++)
        {
            // Campo de visión de unos 80° × 70°
            float yaw = Mathf.Lerp(-40f, 40f, c / (Cols - 1f));
            float pitch = Mathf.Lerp(-35f, 35f, r / (Rows - 1f));
            Vector3 dir = head.rotation * (Quaternion.Euler(-pitch, yaw, 0) * Vector3.forward);
            EnvironmentRaycastHit hit;
            rayTotal++;
            if (!raycaster.Raycast(new Ray(hp, dir), out hit, 12f)) continue;
            rayHits++;
            Vector3 p = hit.point;
            float px = p.x, pz = -p.z, py = p.y;
            float dx = px - hx, dz = pz - hz, dy = py - hy;
            float d = Mathf.Sqrt(dx * dx + dz * dz);

            // Techo: rayos muy inclinados hacia arriba
            if (dy > 0.6f && dy > d * 0.7f && py > 1.9f && py < 12f)
            {
                int b = Mathf.RoundToInt(py / 0.05f);
                int n; ceil.TryGetValue(b, out n); ceil[b] = n + 1;
            }
            if (d < 0.3f) continue;

            // Suelo visto: celdas entre la cabeza y el punto
            float reach = Mathf.Min(d - 0.08f, MaxRange);
            int steps = Mathf.CeilToInt(reach / (Cell * 0.9f));
            for (int i = 0; i <= steps; i++)
            {
                float t = reach * i / Mathf.Max(1, steps) / d;
                seenFree.Add(Key(Mathf.FloorToInt((hx + dx * t) / Cell), Mathf.FloorToInt((hz + dz * t) / Cell)));
            }
            long k = Key(Mathf.FloorToInt(px / Cell), Mathf.FloorToInt(pz / Cell));
            // Muebles y obstáculos: entre 0,35 y 2,3 m (a menos de 1 m son las manos)
            if (d >= 1f && d <= MaxRange && py >= 0.35f && py <= 2.3f)
            {
                seenObj.Add(k);
                float h; objH.TryGetValue(k, out h);
                if (py > h) objH[k] = py;
            }
            // Pared: a media altura
            if (d <= MaxRange && py >= 1.0f && py <= 2.3f) seenWall.Add(k);
        }

        foreach (var k in seenFree) { int n; free.TryGetValue(k, out n); free[k] = n + 1; }
        foreach (var k in seenObj) { int n; obj.TryGetValue(k, out n); obj[k] = n + 1; }
        foreach (var k in seenWall)
        {
            int n; wall.TryGetValue(k, out n); wall[k] = n + 1;
            // Punto verde la primera vez que una celda de pared queda confirmada
            if (n + 1 == MinFrames && painted.Add(k) && dots != null && dots.particleCount < 29000)
            {
                var ep = new ParticleSystem.EmitParams();
                ep.position = new Vector3((KeyX(k) + 0.5f) * Cell, 1.5f, -(KeyZ(k) + 0.5f) * Cell);
                ep.startColor = new Color(0.15f, 0.9f, 0.4f, 1f);
                ep.startSize = 0.05f;
                ep.startLifetime = 100000f;
                dots.Emit(ep, 1);
            }
        }
    }

    float Ceiling()
    {
        int best = 0; float h = 0;
        foreach (var kv in ceil) if (kv.Value > best) { best = kv.Value; h = kv.Key * 0.05f; }
        return best >= 20 ? h : 0;
    }

    /// JSON con las rejillas en el formato que lee la web (WalkGrids).
    string BuildJson()
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder(1 << 16);
        sb.Append("{\"format\":\"mice-roomplan\",\"version\":2,\"device\":\"quest\",\"walls\":[],\"walk\":{\"cell\":0.1,\"frames\":").Append(frames);
        float ch = Ceiling();
        if (ch > 0) sb.Append(",\"ceiling\":").Append(ch.ToString("0.00", inv));

        // Suelo: por filas, tramos de celdas seguidas
        var rows = new Dictionary<int, List<int>>();
        foreach (var kv in free)
        {
            if (kv.Value < MinFrames) continue;
            int iz = KeyZ(kv.Key);
            List<int> xs;
            if (!rows.TryGetValue(iz, out xs)) { xs = new List<int>(); rows[iz] = xs; }
            xs.Add(KeyX(kv.Key));
        }
        sb.Append(",\"free\":[");
        bool firstRow = true;
        foreach (var row in rows)
        {
            var xs = row.Value; xs.Sort();
            if (!firstRow) sb.Append(',');
            firstRow = false;
            sb.Append('[').Append(row.Key);
            int x0 = xs[0], prev = xs[0];
            for (int i = 1; i <= xs.Count; i++)
            {
                if (i < xs.Count && xs[i] == prev + 1) { prev = xs[i]; continue; }
                sb.Append(',').Append(x0).Append(',').Append(prev);
                if (i < xs.Count) { x0 = xs[i]; prev = xs[i]; }
            }
            sb.Append(']');
        }
        sb.Append("],\"wall\":[");
        bool first = true;
        foreach (var kv in wall)
        {
            if (kv.Value < MinFrames) continue;
            if (!first) sb.Append(',');
            first = false;
            sb.Append(KeyX(kv.Key)).Append(',').Append(KeyZ(kv.Key));
        }
        sb.Append("],\"obj\":[");
        first = true;
        foreach (var kv in obj)
        {
            if (kv.Value < MinFrames) continue;
            if (!first) sb.Append(',');
            first = false;
            float h; objH.TryGetValue(kv.Key, out h);
            sb.Append(KeyX(kv.Key)).Append(',').Append(KeyZ(kv.Key)).Append(',').Append(Mathf.RoundToInt(h * 100));
        }
        sb.Append("],\"path\":[");
        for (int i = 0; i < path.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(Mathf.RoundToInt(path[i].x * 100)).Append(',').Append(Mathf.RoundToInt(path[i].y * 100));
        }
        sb.Append("]}}");
        return sb.ToString();
    }

    IEnumerator Upload()
    {
        uploading = true;
        status = "Subiendo el escaneo…";
        string body = "{\"p_data\":" + BuildJson() + "}";
        using (var req = new UnityWebRequest(SupabaseUrl + "/rest/v1/rpc/scan_drop", "POST"))
        {
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.SetRequestHeader("apikey", SupabaseKey);
            req.SetRequestHeader("Authorization", "Bearer " + SupabaseKey);
            yield return req.SendWebRequest();
            if (req.result == UnityWebRequest.Result.Success)
            {
                string code = req.downloadHandler.text.Trim().Trim('"');
                status = "ESCANEO SUBIDO\n\nCódigo:  " + code + "\n\nEscríbelo en la web: Espacio → Escaneo de la app de las gafas\n(vale 2 horas)   ·   B/Y: escanear otra sala";
                while (!(OVRInput.GetDown(OVRInput.Button.Two) || OVRInput.GetDown(OVRInput.Button.Four))) yield return null;
                ResetScan();
            }
            else
            {
                status = "No se pudo subir: " + req.error + "\n" + req.downloadHandler.text + "\nComprueba el wifi de las gafas. Gatillo: reintentar";
                while (!(OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger) || OVRInput.GetDown(OVRInput.Button.SecondaryIndexTrigger))) yield return null;
                status = "";
            }
        }
        uploading = false;
    }
}

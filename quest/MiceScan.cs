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

public class MiceScan : MonoBehaviour
{
    const string SupabaseUrl = "https://czpzvcrwejkgtwsvgxpr.supabase.co";
    const string SupabaseKey = "sb_publishable_r50ep5iXZrEVUyLnc1ckXQ_67LcGFio";

    const float Cell = 0.1f;        // tamaño de celda (m)
    const float MaxRange = 5f;      // la profundidad pierde precisión más lejos
    const int MinFrames = 3;        // lecturas distintas para dar una celda por buena
    const int Cols = 20, Rows = 14; // rayos por lectura
    const float Interval = 0.12f;   // segundos entre lecturas

    // El lanzador de rayos y el gestor de profundidad de Meta se buscan por su nombre en tiempo
    // de ejecución: así el script compila aunque cambien de espacio de nombres entre versiones.
    Component raycaster;
    System.Reflection.MethodInfo rayMethod;
    object[] rayArgs;
    System.Reflection.FieldInfo hitPointField;
    System.Reflection.PropertyInfo hitPointProp;
    System.Reflection.PropertyInfo raySupported;

    static readonly Dictionary<string, System.Type> typeCache = new Dictionary<string, System.Type>();
    static System.Type FindType(string name)
    {
        if (typeCache.Count == 0)
        {
            typeCache["_"] = null;
            // Solo los ensamblados de Meta (recorrer todos los del motor tarda demasiado)
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                string an = asm.GetName().Name;
                string al = an.ToLowerInvariant();
                if (!(al.Contains("meta") || al.Contains("oculus") || al.Contains("mrutilitykit") || al.Contains("assembly-csharp"))) continue;
                System.Type[] types;
                try { types = asm.GetTypes(); } catch (System.Exception) { continue; }
                foreach (var t in types)
                    if ((t.Name == "EnvironmentRaycastManager" || t.Name == "EnvironmentDepthManager") && typeof(Component).IsAssignableFrom(t)) typeCache[t.Name] = t;
            }
        }
        System.Type r;
        return typeCache.TryGetValue(name, out r) ? r : null;
    }

    Component FindOrAdd(string typeName)
    {
        // Primero en la escena (los bloques de Meta ya lo traen), por nombre de tipo
        foreach (var mb in Resources.FindObjectsOfTypeAll<MonoBehaviour>())
        {
            if (mb == null || mb.GetType().Name != typeName || !mb.gameObject.scene.IsValid()) continue;
            Note(typeName + " (" + mb.GetType().FullName + ") encontrado en la escena, activo: " + mb.isActiveAndEnabled);
            mb.enabled = true;
            return mb;
        }
        var t = FindType(typeName);
        if (t == null) { Note(typeName + ": el tipo no existe en este SDK"); return null; }
        var c = FindFirstObjectByType(t) as Component;
        Note(typeName + " (" + t.FullName + ") en la escena: " + (c != null));
        if (c == null) c = gameObject.AddComponent(t);
        var b = c as Behaviour;
        if (b != null) b.enabled = true;
        return c;
    }

    const System.Reflection.BindingFlags All = System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static;

    /// Anota en el diagnóstico las propiedades y campos de un objeto cuyo nombre contiene el filtro.
    void Dump(string title, System.Type t, object o, string filter, int max)
    {
        var sb = new StringBuilder(title + ": ");
        int n = 0;
        foreach (var pr in t.GetProperties(All))
        {
            if (filter.Length > 0 && pr.Name.ToLowerInvariant().IndexOf(filter) < 0) continue;
            if (pr.GetIndexParameters().Length > 0 || n++ >= max) continue;
            string v = "?";
            try { if (pr.CanRead && (o != null || pr.GetGetMethod(true).IsStatic)) { var val = pr.GetValue(o); v = val == null ? "null" : val.ToString(); } } catch (System.Exception) { v = "err"; }
            sb.Append(pr.Name).Append(pr.CanWrite ? "*" : "").Append('=').Append(v).Append("; ");
        }
        foreach (var f in t.GetFields(All))
        {
            if (filter.Length > 0 && f.Name.ToLowerInvariant().IndexOf(filter) < 0) continue;
            if (n++ >= max) continue;
            string v = "?";
            try { if (o != null || f.IsStatic) { var val = f.GetValue(o); v = val == null ? "null" : val.ToString(); } } catch (System.Exception) { v = "err"; }
            sb.Append('#').Append(f.Name).Append('=').Append(v).Append("; ");
        }
        Note(sb.ToString());
    }

    /// El gestor de profundidad falla al «preprocesar» (oclusión suave): no hace falta para
    /// lanzar rayos, así que se pide el modo sin oclusión.
    void SetupDepth()
    {
        var depth = FindOrAdd("EnvironmentDepthManager");
        if (depth == null) return;
        var t = depth.GetType();
        Dump("profundidad antes", t, depth, "", 40);
        var pr = t.GetProperty("OcclusionShadersMode", All);
        if (pr != null && pr.CanWrite)
        {
            var names = System.Enum.GetNames(pr.PropertyType);
            string want = System.Array.IndexOf(names, "None") >= 0 ? "None" : names[0];
            pr.SetValue(depth, System.Enum.Parse(pr.PropertyType, want));
            Note("profundidad: modos " + string.Join(",", names) + " · se pone " + want + " · queda " + pr.GetValue(depth));
        }
        else Note("profundidad: no hay propiedad OcclusionShadersMode modificable");
    }

    /// Pide a las gafas que no muestren el límite de seguridad (solo lo aceptan en realidad
    /// mixta y si el proyecto declara «Boundary Visibility Support»). Devuelve el estado.
    string SuppressBoundary()
    {
        var mgr = OVRManager.instance;
        if (mgr == null) return "sin OVRManager";
        var f = typeof(OVRManager).GetField("shouldBoundaryVisibilityBeSuppressed", All);
        if (f == null) return "no existe la opción en este SDK";
        f.SetValue(mgr, true);
        var p = typeof(OVRManager).GetProperty("isBoundaryVisibilitySuppressed", All);
        return "pedido ocultar · oculto ahora: " + (p != null ? p.GetValue(mgr) : "?");
    }

#if UNITY_EDITOR
    // En el editor: deja activado «Boundary Visibility Support» en la configuración de Meta,
    // que es lo que permite a la app ocultar el límite de seguridad.
    [UnityEditor.InitializeOnLoadMethod]
    static void EditorBoundarySetup()
    {
        try
        {
            System.Type cfgType = null;
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                try { cfgType = asm.GetType("OVRProjectConfig"); } catch (System.Exception) { }
                if (cfgType != null) break;
            }
            if (cfgType == null) { Debug.LogWarning("[MiceScan] No se encuentra OVRProjectConfig"); return; }
            var cached = cfgType.GetProperty("CachedProjectConfig", All);
            object cfg = cached != null ? cached.GetValue(null) : null;
            if (cfg == null)
            {
                var get = cfgType.GetMethod("GetProjectConfig", All);
                if (get != null && get.GetParameters().Length == 0) cfg = get.Invoke(null, null);
            }
            if (cfg == null) { Debug.LogWarning("[MiceScan] No se pudo leer la configuración de Meta"); return; }
            bool found = false, changed = false;
            var names = new StringBuilder();
            foreach (var fld in cfgType.GetFields(All))
            {
                if (fld.Name.ToLowerInvariant().IndexOf("boundary") < 0) continue;
                found = true;
                names.Append(fld.Name).Append('=').Append(fld.GetValue(cfg)).Append("; ");
                if (!fld.FieldType.IsEnum) continue;
                var opts = System.Enum.GetNames(fld.FieldType);
                if (System.Array.IndexOf(opts, "Supported") < 0 || fld.GetValue(cfg).ToString() != "None" && fld.GetValue(cfg).ToString() != "Unsupported") continue;
                fld.SetValue(cfg, System.Enum.Parse(fld.FieldType, "Supported"));
                changed = true;
            }
            if (changed)
            {
                var commit = cfgType.GetMethod("CommitProjectConfig", All);
                if (commit != null) commit.Invoke(null, new object[] { cfg });
                else UnityEditor.EditorUtility.SetDirty((Object)cfg);
                UnityEditor.AssetDatabase.SaveAssets();
                Debug.Log("[MiceScan] Activado Boundary Visibility Support (límite de seguridad ocultable). Antes: " + names);
            }
            else Debug.Log("[MiceScan] Boundary Visibility Support: " + (found ? "ya configurado · " + names : "no hay ninguna opción de límite en la configuración"));
        }
        catch (System.Exception e) { Debug.LogWarning("[MiceScan] No se pudo configurar el límite: " + e.Message); }
    }
#endif

    void SetupRaycaster()
    {
        raycaster = FindOrAdd("EnvironmentRaycastManager");
        if (raycaster == null) return;
        var t = raycaster.GetType();
        raySupported = t.GetProperty("IsSupported", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
        foreach (var m in t.GetMethods())
        {
            if (m.Name != "Raycast") continue;
            var ps = m.GetParameters();
            var sig = new StringBuilder("rayos: firma Raycast(");
            foreach (var q in ps) sig.Append(q.ParameterType.Name).Append(' ').Append(q.Name).Append(", ");
            Note(sig.Append(')').ToString());
            if (ps.Length < 2 || ps[0].ParameterType != typeof(Ray) || !ps[1].IsOut) continue;
            if (rayMethod != null && ps.Length >= rayMethod.GetParameters().Length) continue;
            rayMethod = m;
        }
        if (rayMethod == null) { Note("rayos: no hay un método Raycast(Ray, out …) reconocible"); return; }
        var pars = rayMethod.GetParameters();
        rayArgs = new object[pars.Length];
        for (int i = 2; i < pars.Length; i++)
            rayArgs[i] = pars[i].HasDefaultValue ? pars[i].DefaultValue : (pars[i].ParameterType == typeof(float) ? (object)12f : null);
        var hitType = pars[1].ParameterType.GetElementType();
        hitPointField = hitType.GetField("point");
        hitPointProp = hitType.GetProperty("point");
        Note("rayos: método con " + pars.Length + " parámetros · impacto " + hitType.Name + " · punto " + (hitPointField != null || hitPointProp != null));
    }

    bool RaySupported()
    {
        if (raycaster == null || rayMethod == null) return false;
        try { return raySupported == null || (bool)raySupported.GetValue(null); } catch (System.Exception) { return true; }
    }

    bool Cast(Ray ray, out Vector3 point)
    {
        point = Vector3.zero;
        rayArgs[0] = ray;
        rayArgs[1] = null;
        bool ok = (bool)rayMethod.Invoke(raycaster, rayArgs);
        if (!ok) return false;
        object hit = rayArgs[1];
        if (hitPointField != null) point = (Vector3)hitPointField.GetValue(hit);
        else if (hitPointProp != null) point = (Vector3)hitPointProp.GetValue(hit);
        else return false;
        return true;
    }

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
        if (type != LogType.Error && type != LogType.Exception && type != LogType.Assert) return;
        string key = msg.Length > 60 ? msg.Substring(0, 60) : msg;
        int seen; errorCount.TryGetValue(key, out seen); errorCount[key] = seen + 1;
        if (seen < 2)
            Note("[" + type + "] " + msg + " | " + (stack ?? "").Replace("\n", " / "));
    }
    readonly Dictionary<string, int> errorCount = new Dictionary<string, int>();
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

    bool ready;

    // El arranque va por etapas, con una pausa y un envío de diagnóstico entre cada una: si
    // alguna bloquea la app, la última línea recibida dice cuál ha sido.
    IEnumerator Start()
    {
        Note("MiceScan v7 · Unity " + Application.unityVersion + " · " + SystemInfo.deviceModel + " · " + SystemInfo.graphicsDeviceType);
        try
        {
            var rig = FindFirstObjectByType<OVRCameraRig>();
            head = rig != null ? rig.centerEyeAnchor : (Camera.main != null ? Camera.main.transform : null);
            Note("cabeza: " + (rig != null ? "OVRCameraRig" : head != null ? "Camera.main" : "NINGUNA"));
        }
        catch (System.Exception e) { Note("ERROR cabeza: " + e.Message); }
        Note("etapa 1 hecha (cabeza); sigue: permiso");
        yield return SendLog();

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
        Note("etapa 2 hecha (permiso); sigue: profundidad");
        yield return SendLog();
        try { SetupDepth(); }
        catch (System.Exception e) { Note("ERROR profundidad: " + e.Message); }
        Note("etapa 3 hecha (profundidad); sigue: rayos");
        yield return SendLog();
        try { SetupRaycaster(); Note("rayos admitidos: " + RaySupported()); }
        catch (System.Exception e) { Note("ERROR rayos: " + e.Message); }

        Note("etapa 4 hecha (rayos); sigue: límite");
        yield return SendLog();
        // Sin el límite de seguridad de las gafas: hay que poder caminar por toda la sala.
        // Requiere «Boundary Visibility Support = Supported» en el OVRManager del Camera Rig.
        try { Note("límite de seguridad: " + SuppressBoundary()); }
        catch (System.Exception e) { Note("ERROR límite: " + e.Message); }
        Note("etapa 5 hecha (límite); sigue: texto");
        yield return SendLog();
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

        Note("etapa 6 hecha (texto); sigue: puntos");
        yield return SendLog();
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
        StartCoroutine(SetupCamera());
        Note("arranque completo");
        yield return SendLog();
        ready = true;
    }

    void ResetScan()
    {
        photos.Clear(); photoMeta.Clear(); shots.Clear();
        free.Clear(); wall.Clear(); obj.Clear(); objH.Clear(); ceil.Clear(); path.Clear(); painted.Clear();
        frames = 0;
        if (dots != null) dots.Clear();
        status = "";
    }

    void Update()
    {
        if (!ready) return;
        // Diagnóstico al servidor: a los 6 s y luego cada 15 s mientras haya líneas nuevas (2 primeros minutos)
        if (Time.time > nextLog && Time.time < 130f)
        {
            nextLog = Time.time + 15f;
            string lim = "?";
            try { lim = SuppressBoundary(); } catch (System.Exception) { }
            Note("estado: escena " + sceneCount + " (" + sceneLabels + ") · fotos " + photos.Count + " · límite " + lim + " · rayos admitidos " + RaySupported() + " · lecturas " + frames + " · rayos con impacto " + rayHits + "/" + rayTotal + " · suelo " + free.Count + " · pared " + wall.Count + " · quieta " + still);
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
        if (OVRInput.GetDown(OVRInput.Button.PrimaryHandTrigger) || OVRInput.GetDown(OVRInput.Button.SecondaryHandTrigger))
        {
            try { RequestMetaScan(); } catch (System.Exception e) { Note("ERROR escaneo de Meta: " + e.Message); status = "No se pudo abrir el escaneo de las gafas"; }
        }
        if (Time.time > nextScene)
        {
            nextScene = Time.time + 2f;
            try { CountScene(); } catch (System.Exception e) { if (sceneErrors++ < 2) Note("ERROR escena: " + e.Message); }
            if (reloadScene > 0 && Time.time > reloadScene) { reloadScene = 0; try { ReloadScene(); } catch (System.Exception e) { Note("ERROR recarga de escena: " + e.Message); } }
        }
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

        if (still >= 8) { try { TryCapture(); } catch (System.Exception e) { if (camErrors++ < 3) Note("ERROR foto: " + e.Message); } }
        if (Time.time < nextRead || still < 3) return;
        nextRead = Time.time + Interval;
        if (!RaySupported()) { status = "Estas gafas no dan el mapa de profundidad"; return; }
        try { ReadFrame(); }
        catch (System.Exception e)
        {
            if (readErrors++ < 3) Note("ERROR lectura: " + e.GetType().Name + " " + e.Message + (e.InnerException != null ? " / " + e.InnerException.Message : ""));
            status = "Error al leer la profundidad";
        }
    }
    int readErrors;

    string Message()
    {
        if (uploading) return status;
        float m2 = 0;
        foreach (var kv in free) if (kv.Value >= MinFrames) m2 += Cell * Cell;
        int walls = 0;
        foreach (var kv in wall) if (kv.Value >= MinFrames) walls++;
        string s = "MICE Scan — camina por toda la sala mirando a las paredes\n"
                 + "Suelo visto: " + m2.ToString("0") + " m2 · paredes: " + (walls * Cell).ToString("0") + " m · fotos: " + photos.Count + (cam == null ? " (sin cámara)" : "") + "\n"
                 + "Sala anotada por las gafas: " + (sceneCount > 0 ? sceneWalls + " paredes, " + sceneFurniture + " muebles" : "ninguna (botón lateral: escanearla)") + "\n"
                 + "Gatillo: terminar y subir · B/Y: empezar de nuevo · A/X: puntos · Lateral: escaneo de Meta";
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
            Vector3 p;
            rayTotal++;
            if (!Cast(new Ray(hp, dir), out p)) continue;
            rayHits++;
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
        sb.Append("]}");
        string scene = "";
        try { scene = SceneJson(); } catch (System.Exception e) { Note("ERROR escena: " + e.Message); }
        if (scene.Length > 0) sb.Append(",\"scene\":[").Append(scene).Append(']');
        sb.Append('}');
        return sb.ToString();
    }

    // ---------------- Sala anotada por las gafas (escaneo de Meta: paredes, puertas, muebles) ----------------
    int sceneCount, sceneWalls, sceneFurniture, sceneErrors;
    string sceneLabels = "";
    float nextScene, reloadScene;

    static object Member(object o, string name)
    {
        var t = o.GetType();
        var p = t.GetProperty(name, All);
        if (p != null) return p.GetValue(o);
        var f = t.GetField(name, All);
        return f != null ? f.GetValue(o) : null;
    }

    List<MonoBehaviour> SceneAnchors()
    {
        var list = new List<MonoBehaviour>();
        foreach (var mb in Resources.FindObjectsOfTypeAll<MonoBehaviour>())
            if (mb != null && mb.GetType().Name == "MRUKAnchor" && mb.gameObject.scene.IsValid() && mb.gameObject.activeInHierarchy) list.Add(mb);
        return list;
    }

    void CountScene()
    {
        var hist = new Dictionary<string, int>();
        int walls = 0, furn = 0, n = 0;
        foreach (var a in SceneAnchors())
        {
            n++;
            object lab = Member(a, "Label");
            string l = lab != null ? lab.ToString() : "?";
            int c; hist.TryGetValue(l, out c); hist[l] = c + 1;
            if (l.Contains("WALL_FACE")) walls++;
            else if (Member(a, "VolumeBounds") is Bounds) furn++;
        }
        sceneCount = n; sceneWalls = walls; sceneFurniture = furn;
        var sb = new StringBuilder();
        foreach (var kv in hist) sb.Append(kv.Key).Append(':').Append(kv.Value).Append(' ');
        sceneLabels = sb.ToString();
    }

    /// Los elementos anotados por las gafas, tal cual (posición, giro, rectángulo o caja local).
    string SceneJson()
    {
        var inv = CultureInfo.InvariantCulture;
        var rooms = new Dictionary<Transform, int>();
        var sb = new StringBuilder();
        int n = 0;
        foreach (var a in SceneAnchors())
        {
            object lab = Member(a, "Label");
            string l = lab != null ? lab.ToString() : "OTHER";
            if (l.Contains("GLOBAL_MESH")) continue;
            Transform parent = a.transform.parent != null ? a.transform.parent : a.transform;
            int room; if (!rooms.TryGetValue(parent, out room)) { room = rooms.Count; rooms[parent] = room; }
            Vector3 p = a.transform.position; Quaternion q = a.transform.rotation;
            if (n++ > 0) sb.Append(',');
            sb.Append("{\"label\":\"").Append(Esc(l)).Append("\",\"room\":").Append(room)
              .Append(",\"pos\":[").Append(p.x.ToString("0.###", inv)).Append(',').Append(p.y.ToString("0.###", inv)).Append(',').Append(p.z.ToString("0.###", inv)).Append(']')
              .Append(",\"rot\":[").Append(q.x.ToString("0.#####", inv)).Append(',').Append(q.y.ToString("0.#####", inv)).Append(',').Append(q.z.ToString("0.#####", inv)).Append(',').Append(q.w.ToString("0.#####", inv)).Append(']');
            object pr = Member(a, "PlaneRect");
            if (pr is Rect)
            {
                Rect r = (Rect)pr;
                sb.Append(",\"rect\":[").Append(r.x.ToString("0.###", inv)).Append(',').Append(r.y.ToString("0.###", inv)).Append(',').Append(r.width.ToString("0.###", inv)).Append(',').Append(r.height.ToString("0.###", inv)).Append(']');
            }
            object vb = Member(a, "VolumeBounds");
            if (vb is Bounds)
            {
                Bounds b = (Bounds)vb;
                sb.Append(",\"vol\":[").Append(b.center.x.ToString("0.###", inv)).Append(',').Append(b.center.y.ToString("0.###", inv)).Append(',').Append(b.center.z.ToString("0.###", inv)).Append(',')
                  .Append(b.size.x.ToString("0.###", inv)).Append(',').Append(b.size.y.ToString("0.###", inv)).Append(',').Append(b.size.z.ToString("0.###", inv)).Append(']');
            }
            sb.Append('}');
            if (n >= 300) break;
        }
        return sb.ToString();
    }

    static object[] DefaultArgs(System.Reflection.MethodInfo m)
    {
        var ps = m.GetParameters();
        var args = new object[ps.Length];
        for (int i = 0; i < ps.Length; i++)
            args[i] = ps[i].HasDefaultValue ? ps[i].DefaultValue : (ps[i].ParameterType.IsValueType ? System.Activator.CreateInstance(ps[i].ParameterType) : null);
        return args;
    }

    /// Abre el escaneo de la sala de las gafas (el de Meta, que reconoce muebles) y después lo vuelve a leer.
    void RequestMetaScan()
    {
        var t = typeof(OVRManager).Assembly.GetType("OVRScene");
        System.Reflection.MethodInfo best = null;
        if (t != null)
            foreach (var m in t.GetMethods(All))
                if (m.Name == "RequestSpaceSetup" && (best == null || m.GetParameters().Length < best.GetParameters().Length)) best = m;
        if (best == null) { Note("escaneo de Meta: no existe OVRScene.RequestSpaceSetup (tipo " + (t != null) + ")"); status = "Este SDK no permite abrir el escaneo de las gafas desde la app"; return; }
        best.Invoke(null, DefaultArgs(best));
        Note("escaneo de Meta: pedido");
        status = "";
        reloadScene = Time.time + 6f;
    }

    void ReloadScene()
    {
        // Mientras el escaneo de las gafas está abierto, la app no tiene el foco: se espera
        if (!OVRManager.hasInputFocus) { reloadScene = Time.time + 2f; return; }
        MonoBehaviour mruk = null;
        foreach (var mb in Resources.FindObjectsOfTypeAll<MonoBehaviour>())
            if (mb != null && mb.GetType().Name == "MRUK" && mb.gameObject.scene.IsValid()) { mruk = mb; break; }
        if (mruk == null) { Note("recarga de escena: no hay MRUK en la escena"); return; }
        System.Reflection.MethodInfo best = null;
        foreach (var m in mruk.GetType().GetMethods(All))
            if (m.Name == "LoadSceneFromDevice" && (best == null || m.GetParameters().Length < best.GetParameters().Length)) best = m;
        if (best == null) { Note("recarga de escena: no existe LoadSceneFromDevice"); return; }
        best.Invoke(mruk, DefaultArgs(best));
        Note("recarga de escena: pedida");
    }

    // ---------------- Fotos con las cámaras de las gafas (Passthrough Camera API) ----------------
    WebCamTexture cam;
    Texture2D camTex;
    int camErrors;
    readonly List<byte[]> photos = new List<byte[]>();
    readonly List<string> photoMeta = new List<string>();
    readonly List<Vector4> shots = new List<Vector4>(); // x, z, rumbo (grados), 0
    const int MaxPhotos = 40;

    IEnumerator SetupCamera()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        string[] perms = { "horizonos.permission.HEADSET_CAMERA", "android.permission.CAMERA" };
        bool asked = false;
        foreach (var pm in perms) if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(pm)) asked = true;
        if (asked) UnityEngine.Android.Permission.RequestUserPermissions(perms);
        float until = Time.time + 20f;
        while (Time.time < until)
        {
            bool all = true;
            foreach (var pm in perms) if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(pm)) all = false;
            if (all) break;
            yield return new WaitForSeconds(0.5f);
        }
        foreach (var pm in perms) Note("cámara: permiso " + pm + " = " + UnityEngine.Android.Permission.HasUserAuthorizedPermission(pm));
        try { CameraInfo(); } catch (System.Exception e) { Note("cámara: sin datos de Camera2 (" + e.Message + ")"); }
#endif
        WebCamDevice[] devs = new WebCamDevice[0];
        try { devs = WebCamTexture.devices; } catch (System.Exception e) { Note("ERROR cámara (lista): " + e.Message); }
        var names = new StringBuilder("cámara: dispositivos " + devs.Length + ": ");
        foreach (var d in devs) names.Append(d.name).Append(d.isFrontFacing ? " (frontal)" : "").Append("; ");
        Note(names.ToString());
        if (devs.Length == 0) { yield return SendLog(); yield break; }
        WebCamTexture t = null;
        try { t = new WebCamTexture(devs[0].name, 1280, 960, 15); t.Play(); }
        catch (System.Exception e) { Note("ERROR cámara (abrir): " + e.Message); }
        if (t == null) { yield return SendLog(); yield break; }
        float wait = Time.time + 8f;
        while (t.width <= 16 && Time.time < wait) yield return null;
        Note("cámara: " + devs[0].name + " · " + t.width + "x" + t.height + " · activa " + t.isPlaying + " · giro " + t.videoRotationAngle + " · espejo vertical " + t.videoVerticallyMirrored);
        if (t.width > 16) cam = t;
        yield return SendLog();
    }

#if UNITY_ANDROID && !UNITY_EDITOR
    /// Datos de las cámaras según Android (Camera2): calibración y posición respecto a la cabeza.
    void CameraInfo()
    {
        using (var up = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
        using (var act = up.GetStatic<AndroidJavaObject>("currentActivity"))
        using (var cm = act.Call<AndroidJavaObject>("getSystemService", "camera"))
        using (var keys = new AndroidJavaClass("android.hardware.camera2.CameraCharacteristics"))
        {
            string[] ids = cm.Call<string[]>("getCameraIdList");
            Note("cámara: Camera2 ids " + string.Join(",", ids));
            foreach (var id in ids)
            {
                var sb = new StringBuilder("cámara " + id + ": ");
                using (var ch = cm.Call<AndroidJavaObject>("getCameraCharacteristics", id))
                {
                    foreach (var k in new[] { "LENS_INTRINSIC_CALIBRATION", "LENS_POSE_TRANSLATION", "LENS_POSE_ROTATION", "LENS_DISTORTION" })
                    {
                        try
                        {
                            using (var key = keys.GetStatic<AndroidJavaObject>(k))
                            using (var val = ch.Call<AndroidJavaObject>("get", key))
                            {
                                if (val == null) { sb.Append(k).Append("=null; "); continue; }
                                float[] f = AndroidJNIHelper.ConvertFromJNIArray<float[]>(val.GetRawObject());
                                sb.Append(k).Append("=[");
                                foreach (var x in f) sb.Append(x.ToString("0.#####", CultureInfo.InvariantCulture)).Append(' ');
                                sb.Append("]; ");
                            }
                        }
                        catch (System.Exception e) { sb.Append(k).Append("=err ").Append(e.Message.Length > 40 ? e.Message.Substring(0, 40) : e.Message).Append("; "); }
                    }
                    try
                    {
                        using (var key = keys.GetStatic<AndroidJavaObject>("SENSOR_INFO_PIXEL_ARRAY_SIZE"))
                        using (var val = ch.Call<AndroidJavaObject>("get", key))
                            sb.Append("sensor=").Append(val.Call<int>("getWidth")).Append('x').Append(val.Call<int>("getHeight")).Append("; ");
                    }
                    catch (System.Exception) { }
                }
                Note(sb.ToString());
            }
        }
    }
#endif

    /// Hace una foto si la cabeza está quieta, mira más o menos horizontal y no hay ya otra
    /// tomada desde cerca con un rumbo parecido.
    void TryCapture()
    {
        if (cam == null || !cam.isPlaying || !cam.didUpdateThisFrame || photos.Count >= MaxPhotos || uploading) return;
        Vector3 f = head.forward;
        if (Mathf.Abs(f.y) > 0.45f) return;
        float yaw = Mathf.Atan2(f.x, f.z) * Mathf.Rad2Deg;
        Vector3 hp = head.position;
        foreach (var sh in shots)
            if (Mathf.Abs(Mathf.DeltaAngle(sh.z, yaw)) < 30f && Vector2.Distance(new Vector2(sh.x, sh.y), new Vector2(hp.x, hp.z)) < 1.5f) return;
        if (camTex == null || camTex.width != cam.width || camTex.height != cam.height) camTex = new Texture2D(cam.width, cam.height, TextureFormat.RGBA32, false);
        camTex.SetPixels32(cam.GetPixels32());
        camTex.Apply(false);
        byte[] jpg = camTex.EncodeToJPG(60);
        if (jpg == null || jpg.Length > 400000) return;
        var inv = CultureInfo.InvariantCulture;
        Quaternion q = head.rotation;
        photoMeta.Add("{\"w\":" + cam.width + ",\"h\":" + cam.height
            + ",\"pos\":[" + hp.x.ToString("0.###", inv) + "," + hp.y.ToString("0.###", inv) + "," + hp.z.ToString("0.###", inv) + "]"
            + ",\"rot\":[" + q.x.ToString("0.#####", inv) + "," + q.y.ToString("0.#####", inv) + "," + q.z.ToString("0.#####", inv) + "," + q.w.ToString("0.#####", inv) + "]"
            + ",\"mirror\":" + (cam.videoVerticallyMirrored ? "true" : "false") + ",\"angle\":" + cam.videoRotationAngle + ",\"t\":" + Time.time.ToString("0.0", inv) + "}");
        photos.Add(jpg);
        shots.Add(new Vector4(hp.x, hp.z, yaw, 0));
        if (photos.Count == 1) Note("cámara: primera foto " + jpg.Length + " bytes");
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
                int sent = 0;
                for (int i = 0; i < photos.Count; i++)
                {
                    status = "Escaneo subido. Subiendo fotos: " + (i + 1) + " de " + photos.Count + "…";
                    string pb = "{\"p_code\":\"" + code + "\",\"p_idx\":" + i + ",\"p_meta\":" + photoMeta[i] + ",\"p_jpeg\":\"" + System.Convert.ToBase64String(photos[i]) + "\"}";
                    using (var pr = new UnityWebRequest(SupabaseUrl + "/rest/v1/rpc/scan_photo_add", "POST"))
                    {
                        pr.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(pb));
                        pr.downloadHandler = new DownloadHandlerBuffer();
                        pr.SetRequestHeader("Content-Type", "application/json");
                        pr.SetRequestHeader("apikey", SupabaseKey);
                        pr.SetRequestHeader("Authorization", "Bearer " + SupabaseKey);
                        yield return pr.SendWebRequest();
                        if (pr.result == UnityWebRequest.Result.Success) sent++;
                        else if (i == 0) Note("ERROR subida de foto: " + pr.error + " " + pr.downloadHandler.text);
                    }
                }
                Note("subida: código " + code + " · fotos " + sent + "/" + photos.Count);
                StartCoroutine(SendLog());
                status = "ESCANEO SUBIDO (" + sent + " fotos)\n\nCódigo:  " + code + "\n\nEscríbelo en la web: Espacio → Escaneo de la app de las gafas\n(vale 2 horas)   ·   B/Y: escanear otra sala";
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

#if UNITY_EDITOR
/// Al compilar para las gafas, añade al manifiesto los permisos de las cámaras (fotos de la sala).
public class MiceScanManifest : UnityEditor.Android.IPostGenerateGradleAndroidProject
{
    public int callbackOrder { get { return 10000; } }

    public void OnPostGenerateGradleAndroidProject(string path)
    {
        try
        {
            string file = System.IO.Path.Combine(path, "src/main/AndroidManifest.xml");
            if (!System.IO.File.Exists(file)) { Debug.LogWarning("[MiceScan] No se encuentra el manifiesto en " + file); return; }
            string xml = System.IO.File.ReadAllText(file);
            string add = "";
            foreach (var p in new[] { "horizonos.permission.HEADSET_CAMERA", "android.permission.CAMERA" })
                if (xml.IndexOf(p) < 0) add += "  <uses-permission android:name=\"" + p + "\" />\n";
            if (add.Length == 0) { Debug.Log("[MiceScan] El manifiesto ya tiene los permisos de cámara"); return; }
            int at = xml.LastIndexOf("</manifest>");
            if (at < 0) return;
            System.IO.File.WriteAllText(file, xml.Substring(0, at) + add + xml.Substring(at));
            Debug.Log("[MiceScan] Permisos de cámara añadidos al manifiesto");
        }
        catch (System.Exception e) { Debug.LogWarning("[MiceScan] No se pudo editar el manifiesto: " + e.Message); }
    }
}
#endif

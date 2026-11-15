// MICE Scan — se ejecuta solo en el editor de Unity, al compilar para las gafas.
// Añade al manifiesto de Android el permiso de las cámaras de Meta (fotos de las paredes),
// sin tener que crear ni editar a mano el archivo AndroidManifest.xml.
//
// Debe guardarse en una carpeta llamada «Editor» dentro de Assets: Assets/Editor/MiceScanManifest.cs

using System.IO;
using UnityEditor.Android;
using UnityEngine;

public class MiceScanManifest : IPostGenerateGradleAndroidProject
{
    public int callbackOrder { get { return 10000; } }

    public void OnPostGenerateGradleAndroidProject(string path)
    {
        string file = Path.Combine(path, "src", "main", "AndroidManifest.xml");
        if (!File.Exists(file)) { Debug.LogWarning("[MiceScan] No se encuentra el manifiesto: " + file); return; }
        string xml = File.ReadAllText(file);
        string add = "";
        foreach (var p in new[] { "horizonos.permission.HEADSET_CAMERA", "android.permission.CAMERA" })
            if (xml.IndexOf("\"" + p + "\"") < 0) add += "  <uses-permission android:name=\"" + p + "\" />\n";
        if (add.Length == 0) { Debug.Log("[MiceScan] El manifiesto ya tenía los permisos de cámara"); return; }
        int at = xml.LastIndexOf("</manifest>");
        if (at < 0) { Debug.LogWarning("[MiceScan] Manifiesto sin </manifest>"); return; }
        File.WriteAllText(file, xml.Substring(0, at) + add + xml.Substring(at));
        Debug.Log("[MiceScan] Permisos de cámara añadidos al manifiesto de la app");
    }
}

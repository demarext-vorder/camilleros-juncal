package ar.com.juncal.camilleros;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            Context c = getContext();
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            JSObject o = new JSObject();
            o.put("code", code);
            o.put("name", pi.versionName);
            call.resolve(o);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        final String token = call.getString("token");
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                dir.mkdirs();
                File out = new File(dir, "update.apk");
                if (out.exists()) out.delete();
                HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
                if (token != null) con.setRequestProperty("Authorization", "Bearer " + token);
                con.setConnectTimeout(15000);
                con.setReadTimeout(30000);
                if (con.getResponseCode() != 200) { call.reject("Servidor respondió " + con.getResponseCode()); return; }
                long total = con.getContentLengthLong();
                InputStream in = con.getInputStream();
                FileOutputStream fo = new FileOutputStream(out);
                byte[] buf = new byte[32768];
                long done = 0; int n; int last = -1;
                while ((n = in.read(buf)) > 0) {
                    fo.write(buf, 0, n);
                    done += n;
                    if (total > 0) {
                        int pct = (int) (done * 100 / total);
                        if (pct != last) { last = pct; JSObject p = new JSObject(); p.put("pct", pct); notifyListeners("progress", p); }
                    }
                }
                fo.close(); in.close();
                if (total > 0 && done != total) { call.reject("Descarga incompleta"); return; }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Error de descarga" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        try {
            Context c = getContext();
            if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(s);
                JSObject o = new JSObject();
                o.put("permiso", true);
                call.resolve(o);
                return;
            }
            File apk = new File(new File(c.getCacheDir(), "updates"), "update.apk");
            Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".updatefp", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            JSObject o = new JSObject();
            o.put("permiso", false);
            call.resolve(o);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "No se pudo abrir el instalador" : e.getMessage());
        }
    }

    @PluginMethod
    public void estadoPermisos(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        o.put("bateria", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        o.put("instalar", Build.VERSION.SDK_INT < 26 || c.getPackageManager().canRequestPackageInstalls());
        call.resolve(o);
    }

    @PluginMethod
    public void pedirBateria(PluginCall call) {
        try {
            Context c = getContext();
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "No se pudo abrir el ajuste" : e.getMessage());
        }
    }

    @PluginMethod
    public void pedirInstalar(PluginCall call) {
        try {
            Context c = getContext();
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "No se pudo abrir el ajuste" : e.getMessage());
        }
    }
}

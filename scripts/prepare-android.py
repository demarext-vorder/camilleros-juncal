#!/usr/bin/env python3
"""Se ejecuta despues de `npx cap add android`: aplica permisos, servicio en segundo plano,
escaner de codigos, iconos y version al proyecto Android generado."""
import os, re, shutil, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AND = os.path.join(ROOT, 'android')
MAN = os.path.join(AND, 'app/src/main/AndroidManifest.xml')
GRADLE = os.path.join(AND, 'app/build.gradle')
RES = os.path.join(AND, 'app/src/main/res')

# 1) Iconos y notificacion
for r, _, files in os.walk(RES):
    for f in files:
        if re.match(r'ic_launcher.*\.webp$', f):
            os.remove(os.path.join(r, f))
shutil.copytree(os.path.join(ROOT, 'resources/android/res'), RES, dirs_exist_ok=True)

# 2) Manifest
m = open(MAN, encoding='utf-8').read()
perms = [
    'android.permission.INTERNET', 'android.permission.CAMERA', 'android.permission.FLASHLIGHT',
    'android.permission.VIBRATE', 'android.permission.WAKE_LOCK', 'android.permission.POST_NOTIFICATIONS',
    'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_DATA_SYNC', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
]
add = ''.join(f'    <uses-permission android:name="{p}" />\n' for p in perms if p not in m)
m = m.replace('<application', add + '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n\n    <application', 1) if '<uses-feature android:name="android.hardware.camera"' not in m else m.replace('<application', add + '    <application', 1)
if 'usesCleartextTraffic' not in m:
    m = m.replace('<application', '<application\n        android:usesCleartextTraffic="true"', 1)
inner = '''
        <meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />
        <receiver android:name="io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver" />
        <service android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService" android:foregroundServiceType="dataSync" />
'''
if 'AndroidForegroundService' not in m:
    m = m.replace('</application>', inner + '    </application>', 1)
# pantalla encendida / avisos sobre pantalla bloqueada
m = m.replace('<activity', '<activity\n            android:showWhenLocked="true"\n            android:turnScreenOn="true"', 1) if 'showWhenLocked' not in m else m
open(MAN, 'w', encoding='utf-8').write(m)

# 2b) Actualizador de APK dentro de la app (plugin propio + FileProvider)
JAVA = os.path.join(AND, 'app/src/main/java/ar/com/juncal/camilleros')
os.makedirs(JAVA, exist_ok=True)
shutil.copy(os.path.join(ROOT, 'scripts/android/ApkUpdaterPlugin.java'), JAVA)
shutil.copy(os.path.join(ROOT, 'scripts/android/UpdateFileProvider.java'), JAVA)
os.makedirs(os.path.join(RES, 'xml'), exist_ok=True)
shutil.copy(os.path.join(ROOT, 'scripts/android/update_paths.xml'), os.path.join(RES, 'xml/update_paths.xml'))
main_java = os.path.join(JAVA, 'MainActivity.java')
open(main_java, 'w', encoding='utf-8').write("""package ar.com.juncal.camilleros;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState)
    }
}
""".replace("super.onCreate(savedInstanceState)\n", "super.onCreate(savedInstanceState);\n"))
m = open(MAN, encoding='utf-8').read()
if 'REQUEST_INSTALL_PACKAGES' not in m:
    m = m.replace('<application', '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n\n    <application', 1)
if 'updatefp' not in m:
    m = m.replace('</application>', """        <provider android:name="ar.com.juncal.camilleros.UpdateFileProvider" android:authorities="${applicationId}.updatefp" android:exported="false" android:grantUriPermissions="true">
            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/update_paths" />
        </provider>
    </application>""", 1)
open(MAN, 'w', encoding='utf-8').write(m)

# 3) Gradle: data binding (lo pide el plugin de escaneo) + version
g = open(GRADLE, encoding='utf-8').read()
if 'dataBinding' not in g:
    g = re.sub(r'android\s*\{', 'android {\n    buildFeatures {\n        dataBinding true\n    }', g, count=1)
code = os.environ.get('VERSION_CODE', '1'); name = os.environ.get('VERSION_NAME', '1.0.0')
g = re.sub(r'versionCode\s+\d+', f'versionCode {code}', g)
g = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', g)
open(GRADLE, 'w', encoding='utf-8').write(g)
print('Proyecto Android preparado: version', name, code)

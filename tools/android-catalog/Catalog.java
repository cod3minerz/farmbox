package io.hashpix.android;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Looper;
import android.os.UserHandle;
import android.util.Base64;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.Method;
import java.util.HashSet;

public final class Catalog {
    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        Class<?> threadClass = Class.forName("android.app.ActivityThread");
        Object thread = threadClass.getMethod("systemMain").invoke(null);
        Context system = (Context) threadClass.getMethod("getSystemContext").invoke(thread);
        system = system.createPackageContext("com.android.shell", 0);
        Method asUser = Context.class.getMethod("createContextAsUser", UserHandle.class, int.class);
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);

        for (String argument : args) {
            int user = Integer.parseInt(argument);
            Context context = (Context) asUser.invoke(system, UserHandle.getUserHandleForUid(user * 100000), 0);
            PackageManager packages = context.getPackageManager();
            HashSet<String> seen = new HashSet<>();
            for (ResolveInfo activity : packages.queryIntentActivities(launcher, 0)) {
                String name = activity.activityInfo.packageName;
                if (!seen.add(name)) continue;
                JSONObject row = new JSONObject();
                row.put("user", user);
                row.put("package", name);
                row.put("component", activity.activityInfo.name);
                row.put("label", activity.loadLabel(packages).toString());
                try {
                    Drawable icon = packages.getResourcesForApplication(activity.activityInfo.applicationInfo)
                            .getDrawable(activity.getIconResource(), null);
                    Bitmap bitmap = Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888);
                    icon.setBounds(0, 0, 48, 48);
                    icon.draw(new Canvas(bitmap));
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
                    bitmap.recycle();
                    row.put("icon", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                } catch (PackageManager.NameNotFoundException | RuntimeException ignored) {
                    // Keep the app selectable if its resource cannot be rendered.
                }
                System.out.println(row.toString());
                if (seen.size() % 12 == 0) System.gc();
            }
        }
    }
}

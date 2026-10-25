package com.tongpin.chat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.AtomicFile;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PHOTO = 10, EXPORT = 11, IMPORT = 12;
    private WebView web;
    private KeyVault vault;
    private AtomicFile stateFile;
    private String pendingExport;
    private final ExecutorService workers = Executors.newFixedThreadPool(3);
    private final ConcurrentHashMap<String, Call> calls = new ConcurrentHashMap<>();
    private static final class Call {
        volatile boolean cancelled;
        volatile HttpsURLConnection connection;
        void cancel() {
            cancelled = true;
            HttpsURLConnection current = connection;
            if (current != null) current.disconnect();
        }
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        vault = new KeyVault(this);
        stateFile = new AtomicFile(new File(getFilesDir(), "conversation.json"));
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(248, 249, 245));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets edges = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.setBackgroundColor(Color.rgb(248, 249, 245));
        web.addJavascriptInterface(new Bridge(), "TongpinNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // This WebView hosts only bundled UI, never arbitrary pages.
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();
                if ("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                        && ("/index.html".equals(path) || "/app.css".equals(path) || "/core.js".equals(path) || "/app.js".equals(path))) {
                    try {
                        String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript";
                        return new WebResourceResponse(mime, "UTF-8", getAssets().open(path.substring(1)));
                    } catch (Exception ignored) { }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        web.loadUrl(ORIGIN + "/index.html");
    }

    private void emit(String callback, JSONObject value) {
        runOnUiThread(() -> { if (!isDestroyed()) web.evaluateJavascript("window." + callback + "(" + value + ")", null); });
    }
    private JSONObject result(boolean ok, String message) {
        JSONObject value = new JSONObject();
        try { value.put("ok", ok).put("message", message); } catch (Exception ignored) { }
        return value;
    }
    private void notice(String text) { emit("__nativeNotice", result(true, text)); }

    final class Bridge {
        @JavascriptInterface public String load() {
            JSONObject output = new JSONObject();
            try {
                output.put("hasKey", !vault.read().isEmpty());
                if (stateFile.getBaseFile().exists()) output.put("state", new JSONObject(new String(stateFile.readFully(), StandardCharsets.UTF_8)));
            } catch (Exception failure) {
                try { output.put("error", "本地数据或密钥读取失败，请检查备份或重新保存 API Key。"); } catch (Exception ignored) { }
            }
            return output.toString();
        }
        @JavascriptInterface public synchronized String save(String json) {
            FileOutputStream output = null;
            try {
                if (json.length() > 6000000) throw new Exception();
                new JSONObject(json);
                output = stateFile.startWrite();
                output.write(json.getBytes(StandardCharsets.UTF_8));
                stateFile.finishWrite(output);
                return result(true, "").toString();
            } catch (Exception failure) {
                if (output != null) stateFile.failWrite(output);
                return result(false, "保存失败，请检查手机剩余空间。").toString();
            }
        }
        @JavascriptInterface public String saveKey(String key) {
            try {
                if (key.length() > 512 || key.matches(".*[\\r\\n].*")) throw new Exception();
                vault.save(key.trim());
                return result(true, "").toString();
            } catch (Exception failure) { return result(false, "密钥保存失败，请重试。").toString(); }
        }
        @JavascriptInterface public void request(String id, String body) {
            if (!id.matches("[A-Za-z0-9_-]{1,80}") || calls.size() >= 3) return;
            Call call = new Call();
            calls.put(id, call);
            workers.execute(() -> perform(id, body, call));
        }
        @JavascriptInterface public void cancel(String id) {
            Call call = calls.get(id);
            if (call != null) workers.execute(call::cancel);
            if (call != null) call.cancelled = true;
        }
        @JavascriptInterface public void photo() { runOnUiThread(() -> launchDocument(PHOTO, "image/*")); }
        @JavascriptInterface public void background() { runOnUiThread(() -> moveTaskToBack(true)); }
        @JavascriptInterface public void exportData(String json) {
            if (json.length() > 6000000) return;
            pendingExport = json;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json")
                        .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, "同频-聊天备份.json");
                try { startActivityForResult(intent, EXPORT); } catch (Exception e) { notice("无法打开文件选择器"); }
            });
        }
        @JavascriptInterface public void importData() { runOnUiThread(() -> launchDocument(IMPORT, "*/*")); }
    }

    private void perform(String id, String body, Call call) {
        JSONObject output = result(false, "连接失败，请检查网络后重试。");
        try {
            if (call.cancelled) return;
            if (body.length() > 180000) throw new Exception("invalid payload");
            JSONObject payload = new JSONObject(body);
            String model = payload.getString("model");
            if (!model.equals("deepseek-chat") && !model.equals("deepseek-reasoner")) throw new Exception("invalid model");
            JSONArray messages = payload.getJSONArray("messages");
            if (messages.length() < 1 || messages.length() > 80) throw new Exception("invalid messages");
            String key = vault.read();
            if (key.isEmpty()) { output = result(false, "请先在设置中填写 DeepSeek API Key。"); return; }
            HttpsURLConnection connection = (HttpsURLConnection) new URL("https://api.deepseek.com/chat/completions").openConnection();
            call.connection = connection;
            if (call.cancelled) return;
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(90000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Authorization", "Bearer " + key);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setDoOutput(true);
            try (OutputStream stream = connection.getOutputStream()) { stream.write(body.getBytes(StandardCharsets.UTF_8)); }
            int code = connection.getResponseCode();
            if (code != 200) {
                String message;
                switch (code) {
                    case 401: message = "API Key 无效，请在设置中重新填写。"; break;
                    case 402: message = "DeepSeek 账户余额不足，请充值后重试。"; break;
                    case 429: message = "请求过于频繁，请稍后再试。"; break;
                    case 400: case 422: message = "请求参数不被支持，请检查模型设置。"; break;
                    case 500: case 502: case 503: message = "DeepSeek 服务暂时繁忙，请稍后再试。"; break;
                    default: message = "请求失败（HTTP " + code + "），请稍后重试。";
                }
                output = result(false, message);
                return;
            }
            JSONObject response;
            try (InputStream stream = connection.getInputStream()) { response = new JSONObject(new String(readLimited(stream, 2000000), StandardCharsets.UTF_8)); }
            JSONObject choice = response.getJSONArray("choices").getJSONObject(0);
            String content = choice.getJSONObject("message").optString("content", "").trim();
            if (content.isEmpty() || content.equals("null")) {
                output = result(false, "模型未返回可见内容。可切换 DeepSeek Chat 后重试。");
            } else {
                output = result(true, "").put("content", content).put("truncated", "length".equals(choice.optString("finish_reason")))
                        .put("usage", response.optJSONObject("usage"));
            }
        } catch (java.net.SocketTimeoutException failure) {
            output = result(false, "连接超时，请检查网络或稍后重试。");
        } catch (Exception failure) {
            output = result(false, "请求失败，请检查网络和 API Key 后重试。");
        } finally {
            calls.remove(id);
            if (call.connection != null) call.connection.disconnect();
            try { output.put("id", id); } catch (Exception ignored) { }
            if (!call.cancelled) emit("__nativeReply", output);
        }
    }

    private static byte[] readLimited(InputStream stream, int limit) throws Exception {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) {
            if (result.size() + count > limit) throw new Exception("file too large");
            result.write(buffer, 0, count);
        }
        return result.toByteArray();
    }
    private void launchDocument(int request, String type) {
        try { startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type), request); }
        catch (Exception e) { notice("无法打开文件选择器"); }
    }
    @Override protected void onActivityResult(int code, int resultCode, Intent data) {
        super.onActivityResult(code, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) { if (code == EXPORT) pendingExport = null; return; }
        Uri uri = data.getData();
        String export = pendingExport;
        if (code == EXPORT) pendingExport = null;
        workers.execute(() -> {
            try {
                if (code == EXPORT && export != null) {
                    try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) { stream.write(export.getBytes(StandardCharsets.UTF_8)); }
                    notice("备份已导出，不包含 API Key。");
                } else if (code == IMPORT) {
                    try (InputStream stream = getContentResolver().openInputStream(uri)) {
                        emit("__nativeImport", new JSONObject().put("data", new String(readLimited(stream, 6000000), StandardCharsets.UTF_8)));
                    }
                } else if (code == PHOTO) {
                    byte[] bytes;
                    try (InputStream stream = getContentResolver().openInputStream(uri)) { bytes = readLimited(stream, 12000000); }
                    BitmapFactory.Options options = new BitmapFactory.Options();
                    options.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                    if (options.outWidth <= 0 || options.outHeight <= 0) throw new Exception("invalid image");
                    options.inSampleSize = 1;
                    while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 512) options.inSampleSize *= 2;
                    options.inJustDecodeBounds = false;
                    Bitmap source = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                    if (source == null) throw new Exception("invalid image");
                    int edge = Math.min(source.getWidth(), source.getHeight());
                    Bitmap crop = Bitmap.createBitmap(source, (source.getWidth() - edge) / 2, (source.getHeight() - edge) / 2, edge, edge);
                    Bitmap thumbnail = Bitmap.createScaledBitmap(crop, 256, 256, true);
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    thumbnail.compress(Bitmap.CompressFormat.JPEG, 85, output);
                    emit("__nativePhoto", new JSONObject().put("data", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)));
                    thumbnail.recycle();
                    if (crop != thumbnail) crop.recycle();
                    if (source != crop && source != thumbnail) source.recycle();
                }
            } catch (Exception failure) { notice("文件处理失败，请选择有效图片（12 MB 内）或同频备份（6 MB 内）。"); }
        });
    }
    @Override public void onBackPressed() { web.evaluateJavascript("window.__androidBack && window.__androidBack()", null); }
    @Override protected void onDestroy() {
        for (Call call : calls.values()) { call.cancelled = true; workers.execute(call::cancel); }
        workers.shutdown();
        web.removeJavascriptInterface("TongpinNative");
        web.destroy();
        super.onDestroy();
    }
}

using System;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace SpireScryer;

public class HttpServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly int _port;
    private readonly string _authToken;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly string[] AllowedOriginPrefixes =
    {
        "http://localhost",
        "https://localhost",
        "http://127.0.0.1",
    };

    public HttpServer(int port, string authToken)
    {
        _port = port;
        _authToken = authToken;
        _listener.Prefixes.Add($"http://localhost:{port}/");
    }

    public static string GenerateToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(24);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .Replace("=", "");
    }

    public void Start()
    {
        if (_listener.IsListening) return;

        _listener.Start();
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => Loop(_cts.Token));
        ModLogger.Info($"HTTP server started on http://localhost:{_port}/");
    }

    private async Task Loop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener.IsListening)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await _listener.GetContextAsync();
            }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (Exception ex)
            {
                ModLogger.Error($"HTTP loop error: {ex.Message}");
                continue;
            }

            _ = Task.Run(() => Handle(ctx));
        }
    }

    private void Handle(HttpListenerContext ctx)
    {
        try
        {
            ApplyCors(ctx);

            if (ctx.Request.HttpMethod == "OPTIONS")
            {
                ctx.Response.StatusCode = 204;
                ctx.Response.Close();
                return;
            }

            var path = ctx.Request.Url?.AbsolutePath ?? "/";

            if (path == "/health")
            {
                WriteJson(ctx.Response, 200, new { ok = true });
                return;
            }

            if (!IsAuthorized(ctx.Request))
            {
                WriteJson(ctx.Response, 401, new { error = "unauthorized" });
                return;
            }

            if (path == "/state" || path == "/")
            {
                var state = GameStateExporter.Export();
                WriteJson(ctx.Response, 200, state);
                return;
            }

            WriteJson(ctx.Response, 404, new { error = "not_found" });
        }
        catch (Exception ex)
        {
            ModLogger.Error($"Handle error: {ex}");
            try
            {
                WriteJson(ctx.Response, 500, new { error = "internal" });
            }
            catch { /* response already closed */ }
        }
    }

    private bool IsAuthorized(HttpListenerRequest request)
    {
        var authHeader = request.Headers["Authorization"];
        if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            var provided = authHeader.Substring("Bearer ".Length).Trim();
            if (ConstantTimeEquals(provided, _authToken)) return true;
        }

        var queryToken = request.QueryString["token"];
        if (!string.IsNullOrEmpty(queryToken) && ConstantTimeEquals(queryToken, _authToken))
        {
            return true;
        }

        return false;
    }

    private static bool ConstantTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    private static void ApplyCors(HttpListenerContext ctx)
    {
        var origin = ctx.Request.Headers["Origin"];
        if (string.IsNullOrEmpty(origin)) return;

        foreach (var prefix in AllowedOriginPrefixes)
        {
            if (origin.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                ctx.Response.Headers.Add("Access-Control-Allow-Origin", origin);
                ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS");
                ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization");
                ctx.Response.Headers.Add("Vary", "Origin");
                return;
            }
        }
    }

    private static void WriteJson(HttpListenerResponse response, int status, object body)
    {
        var json = JsonSerializer.Serialize(body, JsonOpts);
        var bytes = Encoding.UTF8.GetBytes(json);
        response.StatusCode = status;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        response.OutputStream.Write(bytes, 0, bytes.Length);
        response.OutputStream.Close();
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        try { _listener.Stop(); } catch { }
        try { _listener.Close(); } catch { }
        try { _loopTask?.Wait(1000); } catch { }
        ModLogger.Info("HTTP server stopped.");
    }
}

using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace SpireScryer;

public class EbsPusher : IDisposable
{
    private readonly string _ebsUrl;
    private readonly string _modSecret;
    private readonly string _channelId;
    private readonly HttpClient _http = new();
    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private string? _lastPayloadHash;
    private DateTime _lastPushAt = DateTime.MinValue;
    private static readonly TimeSpan PushInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(30);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public EbsPusher(string ebsUrl, string modSecret, string channelId)
    {
        _ebsUrl = ebsUrl.TrimEnd('/');
        _modSecret = modSecret;
        _channelId = channelId;
        _http.Timeout = TimeSpan.FromSeconds(5);
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => Loop(_cts.Token));
        ModLogger.Info($"EBS pusher started → {_ebsUrl}");
    }

    private async Task Loop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(PushInterval, ct);
                await Push();
            }
            catch (TaskCanceledException) { break; }
            catch (Exception ex)
            {
                ModLogger.Warn($"EBS push error: {ex.Message}");
            }
        }
    }

    private async Task Push()
    {
        var state = GameStateExporter.Export();
        var payload = JsonSerializer.Serialize(new { channelId = _channelId, state }, JsonOpts);

        var hash = ComputeHash(payload);
        var now = DateTime.UtcNow;
        var stale = now - _lastPushAt >= KeepAliveInterval;
        if (hash == _lastPayloadHash && !stale) return;

        var req = new HttpRequestMessage(HttpMethod.Post, $"{_ebsUrl}/state");
        req.Headers.Add("X-Mod-Secret", _modSecret);
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");

        var res = await _http.SendAsync(req);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync();
            ModLogger.Warn($"EBS push failed {res.StatusCode}: {body}");
            return;
        }

        _lastPayloadHash = hash;
        _lastPushAt = now;
    }

    private static string ComputeHash(string s)
    {
        using var sha = System.Security.Cryptography.SHA1.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
        return Convert.ToBase64String(bytes);
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        try { _loopTask?.Wait(2000); } catch { }
        try { _http.Dispose(); } catch { }
        ModLogger.Info("EBS pusher stopped.");
    }
}

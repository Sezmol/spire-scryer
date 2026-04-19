using System;
using System.IO;
using MegaCrit.Sts2.Core.Modding;

namespace SpireScryer;

[ModInitializer("OnModLoaded")]
public static class ModEntry
{
    private const int Port = 15555;
    private const string TokenFileName = "spirescryer_token.txt";
    private const string ConfigFileName = "spirescryer_config.txt";

    private static HttpServer? _server;
    private static EbsPusher? _pusher;

    public static void OnModLoaded()
    {
        ModLogger.Info("Loading...");

        try
        {
            var token = GetOrCreateToken();
            _server = new HttpServer(Port, token);
            _server.Start();

            ModLogger.Info("========================================");
            ModLogger.Info($"API endpoint: http://localhost:{Port}/state?token={token}");
            ModLogger.Info($"Token file: {GetTokenPath()}");
            ModLogger.Info("========================================");

            // EBS pusher — только если настроен config файл
            var cfg = ReadConfig();
            if (cfg.HasValue)
            {
                _pusher = new EbsPusher(cfg.Value.EbsUrl, cfg.Value.ModSecret, cfg.Value.ChannelId);
                _pusher.Start();
                ModLogger.Info($"Twitch EBS push enabled → channel {cfg.Value.ChannelId}");
            }
            else
            {
                ModLogger.Info("EBS not configured (no spirescryer_config.txt) — local mode only.");
            }
        }
        catch (Exception ex)
        {
            ModLogger.Error($"Failed to start: {ex}");
        }
    }

    /// <summary>
    /// Токен хранится в user-папке рядом с сейвами.
    /// Если файла нет — генерим новый. Иначе читаем существующий.
    /// </summary>
    private static string GetOrCreateToken()
    {
        var path = GetTokenPath();

        if (File.Exists(path))
        {
            var existing = File.ReadAllText(path).Trim();
            if (!string.IsNullOrEmpty(existing) && existing.Length >= 20)
            {
                return existing;
            }
        }

        var token = HttpServer.GenerateToken();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, token);
        }
        catch (Exception ex)
        {
            ModLogger.Warn($"Could not persist token to {path}: {ex.Message}. Token will regenerate on restart.");
        }

        return token;
    }

    private static string GetTokenPath()
    {
        var appdata = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appdata, "MegaCrit", "SlayTheSpire2", TokenFileName);
    }

    private static string GetConfigPath()
    {
        var appdata = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appdata, "MegaCrit", "SlayTheSpire2", ConfigFileName);
    }

    private record struct EbsConfig(string EbsUrl, string ModSecret, string ChannelId);

    private static EbsConfig? ReadConfig()
    {
        var path = GetConfigPath();
        if (!File.Exists(path)) return null;

        try
        {
            var lines = File.ReadAllLines(path);
            string? ebsUrl = null, modSecret = null, channelId = null;

            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("#") || !trimmed.Contains('=')) continue;
                var idx = trimmed.IndexOf('=');
                var key = trimmed[..idx].Trim().ToUpperInvariant();
                var val = trimmed[(idx + 1)..].Trim();

                if (key == "EBS_URL")        ebsUrl = val;
                else if (key == "MOD_SECRET") modSecret = val;
                else if (key == "CHANNEL_ID") channelId = val;
            }

            if (!string.IsNullOrEmpty(ebsUrl) &&
                !string.IsNullOrEmpty(modSecret) &&
                !string.IsNullOrEmpty(channelId))
                return new EbsConfig(ebsUrl, modSecret, channelId);

            ModLogger.Warn("spirescryer_config.txt found but missing fields (EBS_URL, MOD_SECRET, CHANNEL_ID).");
            return null;
        }
        catch (Exception ex)
        {
            ModLogger.Warn($"Could not read config: {ex.Message}");
            return null;
        }
    }
}

using System;
using System.IO;
using MegaCrit.Sts2.Core.Logging;

namespace SpireScryer;

internal static class ModLogger
{
    private const string Prefix = "[SpireScryer] ";
    private const string LogFileName = "spirescryer.log";
    private const long MaxLogBytes = 1_000_000;

    private static readonly object _lock = new();
    private static string? _logPath;
    private static bool _initialized;

    private static string GetLogPath()
    {
        if (_logPath != null) return _logPath;
        var appdata = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        _logPath = Path.Combine(appdata, "MegaCrit", "SlayTheSpire2", LogFileName);
        return _logPath;
    }

    private static void WriteFile(string level, string msg)
    {
        try
        {
            var path = GetLogPath();
            lock (_lock)
            {
                if (!_initialized)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    if (File.Exists(path) && new FileInfo(path).Length > MaxLogBytes)
                        File.Delete(path);
                    _initialized = true;
                }
                var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{level}] {msg}{Environment.NewLine}";
                File.AppendAllText(path, line);
            }
        }
        catch
        {
            // swallow — logging must never crash the mod
        }
    }

    public static void Info(string msg)
    {
        Log.Info(Prefix + msg);
        WriteFile("INFO", msg);
    }

    public static void Warn(string msg)
    {
        Log.Warn(Prefix + msg);
        WriteFile("WARN", msg);
    }

    public static void Error(string msg)
    {
        Log.Error(Prefix + msg);
        WriteFile("ERROR", msg);
    }
}

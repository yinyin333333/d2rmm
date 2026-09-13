using System;
using System.Diagnostics;
using System.IO;

// A GUI-subsystem launcher has no PowerShell console-host dependency. It can
// detach from Electron, then start PowerShell with a normal hidden console
// configuration and keep its redirected handles alive until the update ends.
internal static class Launcher {
  [STAThread]
  private static int Main(string[] args) {
    if (args.Length != 2) return 2;
    string script = Path.GetFullPath(args[0]);
    string plan = Path.GetFullPath(args[1]);
    string log = Path.Combine(Path.GetDirectoryName(plan), "helper.log");
    try {
      using (var writer = new StreamWriter(log, true)) {
        writer.AutoFlush = true;
        var start = new ProcessStartInfo {
          FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
          Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File \"" + script + "\" -Plan \"" + plan + "\"",
          WorkingDirectory = Path.GetDirectoryName(plan),
          UseShellExecute = false,
          CreateNoWindow = true,
          RedirectStandardOutput = true,
          RedirectStandardError = true,
          RedirectStandardInput = true,
        };
        using (var process = new Process { StartInfo = start }) {
          process.OutputDataReceived += (sender, data) => { if (data.Data != null) lock(writer) writer.WriteLine(data.Data); };
          process.ErrorDataReceived += (sender, data) => { if (data.Data != null) lock(writer) writer.WriteLine(data.Data); };
          if (!process.Start()) throw new IOException("PowerShell did not start.");
          process.StandardInput.Close();
          process.BeginOutputReadLine();
          process.BeginErrorReadLine();
          process.WaitForExit();
          return process.ExitCode;
        }
      }
    } catch (Exception error) {
      File.AppendAllText(log, error.ToString());
      return 1;
    }
  }
}

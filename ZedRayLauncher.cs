using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace ZedRayLauncher
{
    class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string nodeDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + 
                             @"\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.20.0-win-x64";
            
            string nodeExe = Path.Combine(nodeDir, "node.exe");
            if (!File.Exists(nodeExe))
            {
                nodeExe = "node.exe";
            }

            string serverScript = Path.Combine(appDir, "src", "server.js");

            // 1. Start Server Silently in background (No Console Window)
            ProcessStartInfo serverPsi = new ProcessStartInfo();
            serverPsi.FileName = nodeExe;
            serverPsi.Arguments = "\"" + serverScript + "\"";
            serverPsi.WorkingDirectory = appDir;
            serverPsi.WindowStyle = ProcessWindowStyle.Hidden;
            serverPsi.CreateNoWindow = true;
            serverPsi.UseShellExecute = false;

            Process serverProc = null;
            try
            {
                serverProc = Process.Start(serverPsi);
            }
            catch (Exception ex)
            {
                // Fallback
            }

            // 2. Wait 1.2s for port binding
            Thread.Sleep(1200);

            // 3. Launch Native Edge App Window
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            string url = "http://127.0.0.1:4040";

            ProcessStartInfo appPsi = new ProcessStartInfo();
            if (File.Exists(edgePath))
            {
                appPsi.FileName = edgePath;
                appPsi.Arguments = "--app=" + url + " --window-size=450,840 --app-id=zed-ray-desktop";
            }
            else
            {
                appPsi.FileName = url;
                appPsi.UseShellExecute = true;
            }

            try
            {
                Process appProc = Process.Start(appPsi);
                if (appProc != null && File.Exists(edgePath))
                {
                    appProc.WaitForExit();
                }
            }
            catch
            {
                Process.Start(url);
            }

            // Optional cleanup on close
            if (serverProc != null && !serverProc.HasExited)
            {
                try { serverProc.Kill(); } catch { }
            }
        }
    }
}

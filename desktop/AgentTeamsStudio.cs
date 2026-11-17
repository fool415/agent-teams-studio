// AgentTeams Studio — Windows Native WebView2 Host Client (1:1 CPA Desktop Benchmark)
// Compiled with Microsoft (R) Visual C# Compiler version 4.0+ (/target:winexe /platform:x64)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("AgentTeams Studio")]
[assembly: AssemblyProduct("AgentTeams Studio")]
[assembly: AssemblyCompany("AgentTeams")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace AgentTeams.Desktop
{
    static class Program
    {
        private const string AppMutexName = "AgentTeamsStudio_SingleInstance_Mutex";

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        private const int SW_RESTORE = 9;

        [STAThread]
        static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            Log("Main() entered, PID=" + Process.GetCurrentProcess().Id);

            Application.ThreadException += (s, e) =>
            {
                Log("ThreadException: " + e.Exception);
            };
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                Log("UnhandledException: " + e.ExceptionObject);
            };

            bool createdNew;
            using (Mutex mutex = new Mutex(true, AppMutexName, out createdNew))
            {
                if (!createdNew)
                {
                    Log("Mutex exists, activating existing window");
                    Process current = Process.GetCurrentProcess();
                    foreach (Process process in Process.GetProcessesByName(current.ProcessName))
                    {
                        if (process.Id != current.Id && process.MainWindowHandle != IntPtr.Zero)
                        {
                            ShowWindow(process.MainWindowHandle, SW_RESTORE);
                            SetForegroundWindow(process.MainWindowHandle);
                            return;
                        }
                    }
                    MessageBox.Show("AgentTeams Studio 已在后台运行，请查看系统托盘图标！", "单实例守护", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainWindow());
                Log("Application.Run exited");
            }
        }

        internal static void Log(string msg)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "AgentTeamsStudio"
                );
                Directory.CreateDirectory(dir);
                File.AppendAllText(
                    Path.Combine(dir, "host.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + msg + Environment.NewLine,
                    Encoding.UTF8
                );
            }
            catch { }
        }
    }

    public class MainWindow : Form
    {
        private int _port = 4317;
        private int _mirrorPort = 4318;
        private string _closeBehavior = "ask";
        private bool _silentStart = false;
        private bool _startCoreOnLaunch = true;
        private int _windowWidth = 1360;
        private int _windowHeight = 860;

        private Process _coreProcess;
        private bool _ownsCoreProcess = false;
        private WebView2 _webView;
        private Panel _fallbackPanel;
        private Label _fallbackLabel;
        private NotifyIcon _trayIcon;
        private ContextMenuStrip _trayMenu;
        private ToolStripStatusLabel _statusLabel;
        private ToolStrip _toolBar;
        private bool _forceExit = false;
        private bool _webViewReady = false;

        public MainWindow()
        {
            LoadConfig();
            InitForm();
            InitControls();
            InitTray();

            Shown += OnMainWindowShown;
        }

        private void OnMainWindowShown(object sender, EventArgs e)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                EnsureCoreAndInitializeWebView();
            });
        }

        private void LoadConfig()
        {
            try
            {
                string configPath = ResolveConfigPath();
                if (!string.IsNullOrEmpty(configPath) && File.Exists(configPath))
                {
                    int parsedVal;
                    foreach (string line in File.ReadAllLines(configPath, Encoding.UTF8))
                    {
                        string trimmed = line.Trim();
                        if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith("#")) continue;
                        int eq = trimmed.IndexOf('=');
                        if (eq <= 0) continue;
                        string key = trimmed.Substring(0, eq).Trim();
                        string val = trimmed.Substring(eq + 1).Trim().Trim('"', '\'');

                        if (key == "port" && int.TryParse(val, out parsedVal)) _port = parsedVal;
                        else if (key == "mirror-port" && int.TryParse(val, out parsedVal)) _mirrorPort = parsedVal;
                        else if (key == "close-behavior") _closeBehavior = val;
                        else if (key == "silent-start") _silentStart = val.ToLower() == "true";
                        else if (key == "start-core-on-launch") _startCoreOnLaunch = val.ToLower() == "true";
                        else if (key == "window-width" && int.TryParse(val, out parsedVal)) _windowWidth = parsedVal;
                        else if (key == "window-height" && int.TryParse(val, out parsedVal)) _windowHeight = parsedVal;
                    }
                }
            }
            catch { }
        }

        private string ResolveBaseWorkspaceDir()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            if (File.Exists(Path.Combine(baseDir, "studio-core", "bin", "agent-teams-studio.mjs")))
            {
                // Portable bundle: studio-core sits under baseDir
                return baseDir;
            }
            if (File.Exists(Path.Combine(baseDir, "bin", "agent-teams-studio.mjs")))
            {
                return baseDir;
            }
            return baseDir;
        }

        private string ResolveConfigPath()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string configPath = Path.Combine(baseDir, "config.toml");
            if (File.Exists(configPath)) return configPath;
            DirectoryInfo parentDir = Directory.GetParent(baseDir);
            if (parentDir != null)
            {
                string parentConfig = Path.Combine(parentDir.FullName, "config.toml");
                if (File.Exists(parentConfig)) return parentConfig;
            }
            return configPath;
        }

        private void InitForm()
        {
            Text = "AgentTeams Studio · 桌面端控制中心";
            Size = new Size(_windowWidth, _windowHeight);
            MinimumSize = new Size(960, 640);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(7, 9, 14);
            Icon = CreateAppIcon();

            if (_silentStart)
            {
                WindowState = FormWindowState.Minimized;
                ShowInTaskbar = false;
            }
        }

        private void InitControls()
        {
            // Top Toolbar (hidden during normal Apple 18 Liquid Glass WebView2 rendering; only shown if WebView2 falls back)
            _toolBar = new ToolStrip
            {
                BackColor = Color.FromArgb(13, 17, 23),
                ForeColor = Color.FromArgb(243, 244, 246),
                GripStyle = ToolStripGripStyle.Hidden,
                Padding = new Padding(8, 4, 8, 4),
                RenderMode = ToolStripRenderMode.System,
                Visible = false
            };

            ToolStripLabel brand = new ToolStripLabel("🐾 AgentTeams Studio")
            {
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(74, 158, 255)
            };
            _toolBar.Items.Add(brand);
            _toolBar.Items.Add(new ToolStripSeparator());

            _statusLabel = new ToolStripStatusLabel(string.Format("🟡 正在连接工作台 (:{0})...", _port))
            {
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(251, 191, 36)
            };
            _toolBar.Items.Add(_statusLabel);
            _toolBar.Items.Add(new ToolStripSeparator());

            ToolStripButton btnRefresh = new ToolStripButton("🔄 刷新")
            {
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(209, 213, 219)
            };
            btnRefresh.Click += (s, e) => RefreshStudioView();
            _toolBar.Items.Add(btnRefresh);

            ToolStripButton btnHeal = new ToolStripButton("🐕 看门狗自愈")
            {
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(251, 191, 36)
            };
            btnHeal.Click += (s, e) => TriggerWatchdogHeal();
            _toolBar.Items.Add(btnHeal);

            ToolStripButton btnRestart = new ToolStripButton("⚡ 重启内核")
            {
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(209, 213, 219)
            };
            btnRestart.Click += (s, e) => RestartCoreProcess();
            _toolBar.Items.Add(btnRestart);

            ToolStripButton btnBrowser = new ToolStripButton("🌐 外部浏览器")
            {
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(209, 213, 219)
            };
            btnBrowser.Click += (s, e) => OpenExternalBrowser();
            _toolBar.Items.Add(btnBrowser);

            ToolStripButton btnTray = new ToolStripButton("📥 最小化到托盘")
            {
                Font = new Font("Segoe UI", 9f),
                Alignment = ToolStripItemAlignment.Right,
                ForeColor = Color.FromArgb(156, 163, 175)
            };
            btnTray.Click += (s, e) => MinimizeToTray();
            _toolBar.Items.Add(btnTray);

            // Edge WebView2 Control (Chromium)
            string userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AgentTeamsStudio",
                "WebView2"
            );
            try { Directory.CreateDirectory(userDataDir); } catch { }

            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(7, 9, 14),
                CreationProperties = new CoreWebView2CreationProperties
                {
                    UserDataFolder = userDataDir
                }
            };
            _webView.CoreWebView2InitializationCompleted += OnWebViewInitCompleted;
            _webView.NavigationCompleted += OnWebViewNavigationCompleted;

            // Diagnostic Fallback Panel (hidden unless WebView2 fails)
            _fallbackPanel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(13, 17, 23),
                Visible = false,
                Padding = new Padding(36)
            };
            _fallbackLabel = new Label
            {
                AutoSize = false,
                Dock = DockStyle.Top,
                Height = 140,
                Font = new Font("Segoe UI", 10.5f),
                ForeColor = Color.FromArgb(229, 231, 235),
                Text = "正在初始化 Edge WebView2 渲染引擎..."
            };
            Button fallbackBtn = new Button
            {
                Text = "🌐 使用 Edge 应用模式独立窗口打开工作台",
                AutoSize = true,
                Padding = new Padding(14, 8, 14, 8),
                Top = 160,
                Left = 36,
                BackColor = Color.FromArgb(37, 99, 235),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            fallbackBtn.Click += (s, e) => OpenEdgeAppModeOrBrowser();
            _fallbackPanel.Controls.Add(fallbackBtn);
            _fallbackPanel.Controls.Add(_fallbackLabel);

            Controls.Add(_webView);
            Controls.Add(_fallbackPanel);
            Controls.Add(_toolBar);
        }

        private void EnsureCoreAndInitializeWebView()
        {
            bool serverUp = IsCoreHealthy();
            if (!serverUp && _startCoreOnLaunch)
            {
                StartCoreProcess();
                for (int i = 0; i < 20; i++)
                {
                    if (IsCoreHealthy())
                    {
                        serverUp = true;
                        break;
                    }
                    Thread.Sleep(250);
                }
            }

            if (IsDisposed) return;

            BeginInvoke((MethodInvoker)delegate
            {
                if (serverUp)
                {
                    SetStatus(string.Format("🟢 内核就绪 (:{0})", _port), Color.FromArgb(52, 211, 153));
                }
                else
                {
                    SetStatus(string.Format("🟠 等待后台服务 (:{0})", _port), Color.FromArgb(251, 191, 36));
                }
                InitializeWebViewAsync();
            });
        }

        private async void InitializeWebViewAsync()
        {
            try
            {
                Program.Log("Calling EnsureCoreWebView2Async...");
                await _webView.EnsureCoreWebView2Async(null);
                Program.Log("EnsureCoreWebView2Async returned");
            }
            catch (Exception ex)
            {
                Program.Log("EnsureCoreWebView2Async exception: " + ex);
                ShowFallback("WebView2 初始化失败：" + ex.Message + "\n\n您仍可直接点击下方按钮使用 Edge 应用模式打开工作台。");
            }
        }

        private void OnWebViewInitCompleted(object sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            Program.Log("OnWebViewInitCompleted IsSuccess=" + e.IsSuccess + " Err=" + (e.InitializationException != null ? e.InitializationException.ToString() : "none"));
            if (!e.IsSuccess)
            {
                string err = e.InitializationException != null ? e.InitializationException.Message : "未知 WebView2 错误";
                ShowFallback("WebView2 内核加载异常：" + err + "\n\n请确认已安装 Microsoft Edge WebView2 Runtime，或点击下方按钮在 Edge 独立应用窗口中打开。");
                return;
            }

            _webViewReady = true;
            try
            {
                _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
                _webView.CoreWebView2.WebMessageReceived += (ws, we) =>
                {
                    try
                    {
                        string cmd = we.TryGetWebMessageAsString();
                        if (cmd == "refresh") RefreshStudioView();
                        else if (cmd == "heal") TriggerWatchdogHeal();
                        else if (cmd == "restart-core") RestartCoreProcess();
                        else if (cmd == "open-browser") OpenExternalBrowser();
                        else if (cmd == "minimize-tray") MinimizeToTray();
                    }
                    catch { }
                };
            }
            catch { }

            NavigateToStudio();
        }

        private async void OnWebViewNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            Program.Log("OnWebViewNavigationCompleted IsSuccess=" + e.IsSuccess + " Status=" + e.WebErrorStatus);
            if (e.IsSuccess)
            {
                SetStatus(string.Format("🟢 工作台已就绪 (:{0})", _port), Color.FromArgb(52, 211, 153));
                try
                {
                    await Task.Delay(800);
                    if (!IsDisposed && _webViewReady && _webView.CoreWebView2 != null)
                    {
                        string title = _webView.CoreWebView2.DocumentTitle;
                        string rootLen = await _webView.CoreWebView2.ExecuteScriptAsync("String((document.getElementById('root') && document.getElementById('root').innerHTML.length) || 0)");
                        Program.Log("WebView2 DOM verified: title=" + title + " rootHtmlLen=" + rootLen);
                    }
                }
                catch { }
            }
            else
            {
                SetStatus(string.Format("🟡 页面加载重试中 ({0})", e.WebErrorStatus), Color.FromArgb(251, 191, 36));
            }
        }

        private void ShowFallback(string message)
        {
            if (IsDisposed) return;
            _fallbackLabel.Text = message;
            _toolBar.Visible = true;
            _fallbackPanel.Visible = true;
            _fallbackPanel.BringToFront();
            _toolBar.BringToFront();
            SetStatus("🔴 WebView2 降级模式", Color.FromArgb(248, 113, 113));
        }

        private void SetStatus(string text, Color color)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke((MethodInvoker)delegate { SetStatus(text, color); });
                return;
            }
            _statusLabel.Text = text;
            _statusLabel.ForeColor = color;
        }

        private void InitTray()
        {
            _trayMenu = new ContextMenuStrip();
            _trayMenu.Items.Add("🖥️ 显示主界面", null, (s, e) => RestoreFromTray());
            _trayMenu.Items.Add("🐕 看门狗自愈", null, (s, e) => TriggerWatchdogHeal());
            _trayMenu.Items.Add("⚡ 重启内核", null, (s, e) => RestartCoreProcess());
            _trayMenu.Items.Add("🌐 外部浏览器打开", null, (s, e) => OpenExternalBrowser());
            _trayMenu.Items.Add(new ToolStripSeparator());
            _trayMenu.Items.Add("❌ 退出程序", null, (s, e) =>
            {
                _forceExit = true;
                Close();
            });

            _trayIcon = new NotifyIcon
            {
                Text = "AgentTeams Studio 桌面端",
                Icon = CreateAppIcon(),
                ContextMenuStrip = _trayMenu,
                Visible = true
            };
            _trayIcon.DoubleClick += (s, e) => RestoreFromTray();
        }

        private void NavigateToStudio()
        {
            string url = string.Format("http://127.0.0.1:{0}/", _port);
            if (_webViewReady && _webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.Navigate(url);
            }
            else
            {
                _webView.Source = new Uri(url);
            }
        }

        private void RefreshStudioView()
        {
            if (_webViewReady && _webView.CoreWebView2 != null)
            {
                _webView.Reload();
            }
            else
            {
                EnsureCoreAndInitializeWebView();
            }
        }

        private bool IsCoreHealthy()
        {
            try
            {
                string url = string.Format("http://127.0.0.1:{0}/api/desktop/status", _port);
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 800;
                req.ReadWriteTimeout = 800;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return ((int)resp.StatusCode) >= 200 && ((int)resp.StatusCode) < 400;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string ResolveNodeExecutable()
        {
            List<string> candidates = new List<string>();
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                if (!string.IsNullOrEmpty(dir))
                {
                    candidates.Add(Path.Combine(dir.Trim(), "node.exe"));
                }
            }

            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"));
            candidates.Add(Path.Combine(userProfile, "tools", "nodejs", "node.exe"));
            candidates.Add(Path.Combine(userProfile, ".zcode", "tools", "node", "node.exe"));

            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }
            return "node.exe";
        }

        private void StartCoreProcess()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string scriptPath = Path.Combine(baseDir, "studio-core", "bin", "agent-teams-studio.mjs");
                string workingDir = baseDir;
                if (!File.Exists(scriptPath))
                {
                    scriptPath = Path.Combine(baseDir, "bin", "agent-teams-studio.mjs");
                }

                if (!File.Exists(scriptPath))
                {
                    SetStatus("🟡 内核脚本未就绪，尝试连接现有服务", Color.FromArgb(251, 191, 36));
                    return;
                }

                // If running inside dist-desktop\AgentTeamsStudio, prefer parent workspace if package root exists
                string workspaceArg = ResolveBaseWorkspaceDir();
                string nodeExe = ResolveNodeExecutable();

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = string.Format("\"{0}\" --port {1} --mirror-port {2} --workspace \"{3}\"", scriptPath, _port, _mirrorPort, workspaceArg),
                    WorkingDirectory = workingDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                _coreProcess = Process.Start(psi);
                _ownsCoreProcess = _coreProcess != null;
                if (_coreProcess != null)
                {
                    SetStatus(string.Format("🟢 内核守护运行中 (PID: {0})", _coreProcess.Id), Color.FromArgb(52, 211, 153));
                }
            }
            catch
            {
                SetStatus("🔴 内核拉起异常", Color.FromArgb(248, 113, 113));
            }
        }

        private void RestartCoreProcess()
        {
            try
            {
                if (_coreProcess != null && !_coreProcess.HasExited)
                {
                    _coreProcess.Kill();
                    _coreProcess.WaitForExit(3000);
                }
            }
            catch { }

            StartCoreProcess();
            ThreadPool.QueueUserWorkItem(delegate
            {
                for (int i = 0; i < 16; i++)
                {
                    if (IsCoreHealthy()) break;
                    Thread.Sleep(250);
                }
                BeginInvoke((MethodInvoker)delegate
                {
                    RefreshStudioView();
                    _trayIcon.ShowBalloonTip(2000, "AgentTeams Studio", "Core 内核已成功重启！", ToolTipIcon.Info);
                });
            });
        }

        private void TriggerWatchdogHeal()
        {
            try
            {
                string url = string.Format("http://127.0.0.1:{0}/api/watchdog/heal", _port);
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentType = "application/json";
                byte[] data = Encoding.UTF8.GetBytes("{}");
                req.ContentLength = data.Length;
                using (Stream stream = req.GetRequestStream())
                {
                    stream.Write(data, 0, data.Length);
                }

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                    {
                        reader.ReadToEnd();
                        _trayIcon.ShowBalloonTip(3000, "看门狗守护自愈", "自愈巡检已完成，任务与状态已刷新！", ToolTipIcon.Info);
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("看门狗自愈调用失败: " + ex.Message, "自愈巡检", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OpenEdgeAppModeOrBrowser()
        {
            string url = string.Format("http://127.0.0.1:{0}/", _port);
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            if (!File.Exists(edgePath))
            {
                edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
            }
            if (File.Exists(edgePath))
            {
                try
                {
                    Process.Start(edgePath, string.Format("--app=\"{0}\" --window-size={1},{2}", url, _windowWidth, _windowHeight));
                    return;
                }
                catch { }
            }
            OpenExternalBrowser();
        }

        private void OpenExternalBrowser()
        {
            try
            {
                Process.Start(string.Format("http://127.0.0.1:{0}/", _port));
            }
            catch (Exception ex)
            {
                MessageBox.Show("打开默认浏览器失败: " + ex.Message, "系统提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void MinimizeToTray()
        {
            Hide();
            _trayIcon.ShowBalloonTip(1500, "AgentTeams Studio", "已最小化至系统托盘，双击托盘图标可恢复！", ToolTipIcon.Info);
        }

        private void RestoreFromTray()
        {
            Show();
            ShowInTaskbar = true;
            WindowState = FormWindowState.Normal;
            BringToFront();
            Activate();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            Program.Log("OnFormClosing reason=" + e.CloseReason + " closeBehavior=" + _closeBehavior + " forceExit=" + _forceExit);
            if (_forceExit || e.CloseReason == CloseReason.WindowsShutDown || e.CloseReason == CloseReason.ApplicationExitCall)
            {
                Cleanup();
                base.OnFormClosing(e);
                return;
            }

            if (_closeBehavior == "tray")
            {
                e.Cancel = true;
                MinimizeToTray();
                return;
            }

            if (_closeBehavior == "ask")
            {
                DialogResult result = MessageBox.Show(
                    "是否最小化到系统托盘并在后台保持智能体团队守护？\n\n- 点击「是」：最小化到托盘\n- 点击「否」：彻底退出程序",
                    "关闭 AgentTeams Studio",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Question);

                if (result == DialogResult.Yes)
                {
                    e.Cancel = true;
                    MinimizeToTray();
                    return;
                }
                else if (result == DialogResult.Cancel)
                {
                    e.Cancel = true;
                    return;
                }
            }

            Cleanup();
            base.OnFormClosing(e);
        }

        private void Cleanup()
        {
            try
            {
                if (_trayIcon != null)
                {
                    _trayIcon.Visible = false;
                    _trayIcon.Dispose();
                }

                if (_ownsCoreProcess && _coreProcess != null && !_coreProcess.HasExited)
                {
                    _coreProcess.Kill();
                }
            }
            catch { }
        }

        private static Icon CreateAppIcon()
        {
            try
            {
                Icon assocIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (assocIcon != null)
                {
                    return assocIcon;
                }
            }
            catch { }

            try
            {
                string localIco = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app-icon.ico");
                if (File.Exists(localIco))
                {
                    return new Icon(localIco);
                }
            }
            catch { }

            try
            {
                Bitmap bmp = new Bitmap(32, 32);
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.Transparent);
                    using (Brush bgBrush = new SolidBrush(Color.FromArgb(74, 158, 255)))
                    {
                        g.FillEllipse(bgBrush, 2, 2, 28, 28);
                    }
                    using (Brush textBrush = new SolidBrush(Color.White))
                    using (Font font = new Font("Segoe UI", 13f, FontStyle.Bold))
                    {
                        g.DrawString("AT", font, textBrush, 3, 5);
                    }
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
            catch
            {
                return SystemIcons.Application;
            }
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Globalization;
using System.Net.NetworkInformation;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;
using System.Windows.Media.Animation;
using Microsoft.Win32;

namespace ZedRay
{
    public class ServerItem
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Country { get; set; }
        public string Host { get; set; }
        public int Port { get; set; }
        public string Uuid { get; set; }
        public string Network { get; set; }
        public string Security { get; set; }
        public string Sni { get; set; }
        public string Fingerprint { get; set; }
        public string PublicKey { get; set; }
        public string ShortId { get; set; }
        public string Flow { get; set; }
        public string Path { get; set; }
        public int Ping { get; set; }
        public string Source { get; set; }
    }

    public class AppSettings
    {
        public string Mode;
        public int Mtu;
        public bool Watchdog;
        public string Routing;
        public string SelectedServerId;
        public string SubName;
        public string SubUrl;
        public double UsedGb;
        public double TotalGb;
        public int DaysLeft;

        public AppSettings()
        {
            Mode = "system_proxy";
            Mtu = 1400;
            Watchdog = true;
            Routing = "rule";
            SelectedServerId = "auto";
            SubName = "";
            SubUrl = "";
            UsedGb = 0;
            TotalGb = 0;
            DaysLeft = 0;
        }
    }

    public class MainWindow : Window
    {
        private string appDir;
        private string dataDir;
        private string binDir;
        private string serversFile;
        private string settingsFile;
        private string runtimeConfigFile;

        private List<ServerItem> servers = new List<ServerItem>();
        private AppSettings settings = new AppSettings();

        private Process singboxProcess = null;
        private bool isConnected = false;
        private bool isConnecting = false;
        private ServerItem activeServer = null;
        private DateTime connectStartTime;

        private DispatcherTimer uiTimer;
        private DispatcherTimer watchdogTimer;
        private int watchdogFails = 0;
        private List<double> speedHistory = new List<double>();
        private Random rng = new Random();

        // UI Controls
        private Border headerStatusBadge;
        private Ellipse headerStatusDot;
        private TextBlock headerStatusText;

        private Button[] navButtons = new Button[4];
        private Grid[] tabViews = new Grid[4];

        // Dashboard Controls
        private Border securityCard;
        private TextBlock secTitleText;
        private TextBlock secSubText;
        private Ellipse outerGlowRing;
        private Border powerBtnBorder;
        private TextBlock powerBtnLabel;
        private TextBlock timerText;
        private TextBlock speedDownText;
        private TextBlock speedUpText;
        private Canvas speedGraphCanvas;
        private Border activeServerCard;
        private Grid activeFlagContainer;
        private TextBlock activeServerNameText;
        private TextBlock activeServerMetaText;
        private TextBlock modeBadgeText;

        // Servers Tab Controls
        private TextBlock subTitleText;
        private TextBlock subMetaText;
        private Border subProgressFill;
        private TextBlock subUsageText;
        private TextBlock subDaysText;
        private TextBox searchBox;
        private Border autoSelectCard;
        private StackPanel serversStack;
        private Border subProgressBg;
        private Grid subStatsGrid;
        private long lastRx = -1, lastTx = -1;

        // Settings Controls
        private Border modeCardProxy;
        private Border modeCardTun;
        private CheckBox chkWatchdog;
        private ComboBox cmbMtu;
        private Border routeCardSmart;
        private Border routeCardGlobal;
        private RotateTransform syncRotateTransform;
        private TextBlock searchPlaceholder;

        // Modal Overlay
        private Grid modalOverlay;
        private TextBox txtVlessLink;
        private TextBox txtSubName;
        private TextBox txtSubUrl;

        // System Tray
        private System.Windows.Forms.NotifyIcon trayIcon;

        public MainWindow()
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory;
            dataDir = System.IO.Path.Combine(appDir, "data");
            binDir = System.IO.Path.Combine(appDir, "bin");
            serversFile = System.IO.Path.Combine(dataDir, "zedray_servers.dat");
            settingsFile = System.IO.Path.Combine(dataDir, "zedray_settings.dat");
            runtimeConfigFile = System.IO.Path.Combine(dataDir, "runtime_config.json");

            if (!Directory.Exists(dataDir)) Directory.CreateDirectory(dataDir);
            for (int i = 0; i < 32; i++) speedHistory.Add(0);

            LoadData();
            InitializeWindow();
            SetupTrayIcon();
            SetupTimers();
            RefreshAllUI();
        }

        private void InitializeWindow()
        {
            this.Title = "ZedRay PRO VPN";
            this.Width = 460;
            this.Height = 810;
            this.WindowStartupLocation = WindowStartupLocation.CenterScreen;
            this.WindowStyle = WindowStyle.None;
            this.AllowsTransparency = true;
            this.Background = Brushes.Transparent;
            this.ResizeMode = ResizeMode.CanMinimize;

            string icoPath = System.IO.Path.Combine(appDir, "zedray.ico");
            if (File.Exists(icoPath))
            {
                try { this.Icon = new System.Windows.Media.Imaging.BitmapImage(new Uri(icoPath)); } catch { }
            }

            // Outer Window Border with drop shadow
            Border mainFrame = new Border
            {
                Margin = new Thickness(12),
                CornerRadius = new CornerRadius(22),
                Background = BrushFromHex("#090B12"),
                BorderBrush = BrushFromHex("#1F263D"),
                BorderThickness = new Thickness(1.5),
                Effect = new DropShadowEffect { Color = Colors.Black, BlurRadius = 24, ShadowDepth = 4, Opacity = 0.85 }
            };

            Grid rootGrid = new Grid();
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(64) }); // Titlebar
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(50) }); // Top Segmented Nav
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Content

            // 1. CUSTOM TITLE BAR
            rootGrid.Children.Add(BuildTitleBar());

            // 2. TOP SEGMENTED CYBER NAVIGATION BAR
            Grid navBar = BuildTopNavBar();
            Grid.SetRow(navBar, 1);
            rootGrid.Children.Add(navBar);

            // 3. MAIN CONTENT AREA
            Grid contentHost = new Grid { Margin = new Thickness(18, 10, 18, 16) };
            Grid.SetRow(contentHost, 2);

            tabViews[0] = BuildDashboardTab();
            tabViews[1] = BuildServersTab();
            tabViews[2] = BuildRoutingTab();
            tabViews[3] = BuildSettingsTab();

            for (int i = 0; i < 4; i++)
            {
                tabViews[i].Visibility = (i == 0) ? Visibility.Visible : Visibility.Collapsed;
                contentHost.Children.Add(tabViews[i]);
            }

            rootGrid.Children.Add(contentHost);

            // 4. MODAL OVERLAY FOR ADDING SERVERS / SUBSCRIPTIONS
            modalOverlay = BuildModalOverlay();
            Grid.SetRowSpan(modalOverlay, 3);
            rootGrid.Children.Add(modalOverlay);

            mainFrame.Child = rootGrid;
            this.Content = mainFrame;
        }

        private UIElement BuildTitleBar()
        {
            Border bar = new Border
            {
                Background = BrushFromHex("#0D101B"),
                CornerRadius = new CornerRadius(22, 22, 0, 0),
                BorderBrush = BrushFromHex("#192036"),
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(18, 0, 14, 0)
            };
            bar.MouseLeftButtonDown += (s, e) => { if (e.ButtonState == MouseButtonState.Pressed) this.DragMove(); };

            Grid g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Brand Logo
            StackPanel brandStack = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            Border iconBox = new Border
            {
                Width = 34, Height = 34,
                CornerRadius = new CornerRadius(10),
                Background = new LinearGradientBrush(ColorFromHex("#00F2FE"), ColorFromHex("#3B82F6"), 45),
                Margin = new Thickness(0, 0, 10, 0)
            };
            Polygon bolt = new Polygon
            {
                Points = new PointCollection { new Point(19, 5), new Point(9, 18), new Point(16, 18), new Point(14, 29), new Point(25, 15), new Point(18, 15) },
                Fill = Brushes.White
            };
            iconBox.Child = bolt;
            brandStack.Children.Add(iconBox);

            TextBlock titleTxt = new TextBlock
            {
                Text = "ZedRay",
                FontSize = 20,
                FontWeight = FontWeights.ExtraBold,
                Foreground = Brushes.White,
                VerticalAlignment = VerticalAlignment.Center
            };
            brandStack.Children.Add(titleTxt);

            Border proBadge = new Border
            {
                Background = BrushFromHex("#16233B"),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(8, 2, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            proBadge.Child = new TextBlock { Text = "CORE 1.14", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#00F2FE") };
            brandStack.Children.Add(proBadge);

            g.Children.Add(brandStack);

            // Status Pill in Center-Right
            headerStatusBadge = new Border
            {
                Background = BrushFromHex("#131726"),
                BorderBrush = BrushFromHex("#242B42"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(10, 4, 10, 4),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 12, 0)
            };
            StackPanel statusSp = new StackPanel { Orientation = Orientation.Horizontal };
            headerStatusDot = new Ellipse { Width = 7, Height = 7, Fill = BrushFromHex("#64748B"), Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
            headerStatusText = new TextBlock { Text = "O'CHIRILGAN", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#94A3B8") };
            statusSp.Children.Add(headerStatusDot);
            statusSp.Children.Add(headerStatusText);
            headerStatusBadge.Child = statusSp;
            Grid.SetColumn(headerStatusBadge, 1);
            g.Children.Add(headerStatusBadge);

            // Window Min / Close Buttons
            StackPanel winBtns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            Button minBtn = CreateIconButton("—", "#171C2E", "#94A3B8");
            minBtn.Click += (s, e) => this.WindowState = WindowState.Minimized;
            Button closeBtn = CreateIconButton("✕", "#2A1521", "#F87171");
            closeBtn.Margin = new Thickness(6, 0, 0, 0);
            closeBtn.Click += (s, e) => { DisconnectVpn(); trayIcon.Visible = false; Application.Current.Shutdown(); };
            winBtns.Children.Add(minBtn);
            winBtns.Children.Add(closeBtn);
            Grid.SetColumn(winBtns, 2);
            g.Children.Add(winBtns);

            bar.Child = g;
            return bar;
        }

        private Grid BuildTopNavBar()
        {
            Grid navGrid = new Grid { Margin = new Thickness(18, 10, 18, 0) };
            Border pillBg = new Border
            {
                Background = BrushFromHex("#0F1320"),
                BorderBrush = BrushFromHex("#1D2338"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(4)
            };

            UniformGrid ug = new UniformGrid { Columns = 4 };
            string[] labels = { "⚡ Boshqaruv", "🌐 Serverlar", "🛡️ Marshrut", "⚙️ Sozlama" };

            for (int i = 0; i < 4; i++)
            {
                int idx = i;
                Button b = new Button
                {
                    Content = labels[i],
                    FontSize = 11.5,
                    FontWeight = FontWeights.Bold,
                    BorderThickness = new Thickness(0),
                    Cursor = Cursors.Hand,
                    Background = (i == 0) ? (Brush)new LinearGradientBrush(ColorFromHex("#00F2FE"), ColorFromHex("#3B82F6"), 0) : (Brush)Brushes.Transparent,
                    Foreground = (i == 0) ? BrushFromHex("#04101E") : BrushFromHex("#94A3B8")
                };
                b.Template = CreateRoundedButtonTemplate(10);
                b.Click += (s, e) => SwitchTab(idx);
                navButtons[i] = b;
                ug.Children.Add(b);
            }

            pillBg.Child = ug;
            navGrid.Children.Add(pillBg);
            return navGrid;
        }

        private void SwitchTab(int index)
        {
            for (int i = 0; i < 4; i++)
            {
                tabViews[i].Visibility = (i == index) ? Visibility.Visible : Visibility.Collapsed;
                if (i == index)
                {
                    navButtons[i].Background = new LinearGradientBrush(ColorFromHex("#00F2FE"), ColorFromHex("#3B82F6"), 0);
                    navButtons[i].Foreground = BrushFromHex("#04101E");
                }
                else
                {
                    navButtons[i].Background = Brushes.Transparent;
                    navButtons[i].Foreground = BrushFromHex("#94A3B8");
                }
            }
        }

        // ================= TAB 1: DASHBOARD =================
        private Grid BuildDashboardTab()
        {
            Grid g = new Grid();
            StackPanel sp = new StackPanel { VerticalAlignment = VerticalAlignment.Stretch };

            // 1. Security Status Card
            securityCard = new Border
            {
                Background = BrushFromHex("#111524"),
                BorderBrush = BrushFromHex("#1E253D"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 4, 0, 14)
            };
            Grid secGrid = new Grid();
            secGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            secGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel secLeft = new StackPanel();
            secTitleText = new TextBlock { Text = "HIMOYA O'CHIRILGAN", FontSize = 12, FontWeight = FontWeights.ExtraBold, Foreground = BrushFromHex("#94A3B8") };
            secSubText = new TextBlock { Text = "Tarmoq ochiq · Ulash uchun pastdagi tugmani bosing", FontSize = 11, Foreground = BrushFromHex("#64748B"), Margin = new Thickness(0, 3, 0, 0) };
            secLeft.Children.Add(secTitleText);
            secLeft.Children.Add(secSubText);
            secGrid.Children.Add(secLeft);

            Border modeBadge = new Border
            {
                Background = BrushFromHex("#161D31"),
                BorderBrush = BrushFromHex("#283352"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(8, 4, 8, 4),
                VerticalAlignment = VerticalAlignment.Center
            };
            modeBadgeText = new TextBlock { Text = "PROXY REJIM", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#00F2FE") };
            modeBadge.Child = modeBadgeText;
            Grid.SetColumn(modeBadge, 1);
            secGrid.Children.Add(modeBadge);
            securityCard.Child = secGrid;
            sp.Children.Add(securityCard);

            // 2. Futuristic Cyber Power Button
            Grid powerWrap = new Grid { Height = 195, Margin = new Thickness(0, 2, 0, 6) };
            outerGlowRing = new Ellipse
            {
                Width = 178, Height = 178,
                Stroke = BrushFromHex("#1E263D"),
                StrokeThickness = 2,
                StrokeDashArray = new DoubleCollection { 4, 3 },
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            powerWrap.Children.Add(outerGlowRing);

            powerBtnBorder = new Border
            {
                Width = 144, Height = 144,
                CornerRadius = new CornerRadius(72),
                Background = new LinearGradientBrush(ColorFromHex("#171C2E"), ColorFromHex("#0F1320"), 45),
                BorderBrush = BrushFromHex("#2A3454"),
                BorderThickness = new Thickness(3.5),
                Cursor = Cursors.Hand,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Effect = new DropShadowEffect { Color = Colors.Black, BlurRadius = 25, ShadowDepth = 0, Opacity = 0.7 }
            };
            StackPanel pwrInner = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
            Polygon pwrIcon = new Polygon
            {
                Points = new PointCollection { new Point(22, 2), new Point(6, 24), new Point(19, 24), new Point(15, 42), new Point(34, 18), new Point(21, 18) },
                Fill = BrushFromHex("#00F2FE"),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 6)
            };
            powerBtnLabel = new TextBlock
            {
                Text = "ULASH",
                FontSize = 14,
                FontWeight = FontWeights.ExtraBold,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center
            };
            pwrInner.Children.Add(pwrIcon);
            pwrInner.Children.Add(powerBtnLabel);
            powerBtnBorder.Child = pwrInner;
            powerBtnBorder.MouseLeftButtonDown += (s, e) => ToggleConnection();
            powerWrap.Children.Add(powerBtnBorder);
            sp.Children.Add(powerWrap);

            // 3. Connection Timer
            timerText = new TextBlock
            {
                Text = "00:00:00",
                FontSize = 26,
                FontWeight = FontWeights.ExtraBold,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 14)
            };
            sp.Children.Add(timerText);

            // 4. Live Network Traffic Card & Canvas Graph
            Border netCard = new Border
            {
                Background = BrushFromHex("#111524"),
                BorderBrush = BrushFromHex("#1E253D"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 0, 0, 14)
            };
            StackPanel netSp = new StackPanel();
            UniformGrid speedGrid = new UniformGrid { Columns = 2, Margin = new Thickness(0, 0, 0, 10) };

            StackPanel dlSp = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            dlSp.Children.Add(new TextBlock { Text = "↓ YUKLAB OLISH", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#00F2FE"), HorizontalAlignment = HorizontalAlignment.Center });
            speedDownText = new TextBlock { Text = "0.0 MB/s", FontSize = 17, FontWeight = FontWeights.ExtraBold, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 2, 0, 0) };
            dlSp.Children.Add(speedDownText);

            StackPanel ulSp = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            ulSp.Children.Add(new TextBlock { Text = "↑ UZATISH", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#A855F7"), HorizontalAlignment = HorizontalAlignment.Center });
            speedUpText = new TextBlock { Text = "0.0 MB/s", FontSize = 17, FontWeight = FontWeights.ExtraBold, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 2, 0, 0) };
            ulSp.Children.Add(speedUpText);

            speedGrid.Children.Add(dlSp);
            speedGrid.Children.Add(ulSp);
            netSp.Children.Add(speedGrid);

            speedGraphCanvas = new Canvas { Height = 46, Background = BrushFromHex("#0B0E18"), ClipToBounds = true };
            netSp.Children.Add(speedGraphCanvas);
            netCard.Child = netSp;
            sp.Children.Add(netCard);

            // 5. Active Server Selector Card
            activeServerCard = new Border
            {
                Background = BrushFromHex("#131829"),
                BorderBrush = BrushFromHex("#242D4A"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(14, 12, 14, 12),
                Cursor = Cursors.Hand
            };
            activeServerCard.MouseLeftButtonDown += (s, e) => SwitchTab(1);

            Grid srvGrid = new Grid();
            srvGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            srvGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            srvGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            activeFlagContainer = new Grid { Width = 38, Height = 26, Margin = new Thickness(0, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
            srvGrid.Children.Add(activeFlagContainer);

            StackPanel srvInfo = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            activeServerNameText = new TextBlock { Text = "Hong Kong • Turbo 5G", FontSize = 13.5, FontWeight = FontWeights.Bold, Foreground = Brushes.White };
            activeServerMetaText = new TextBlock { Text = "VLESS · REALITY · 64 ms", FontSize = 11, Foreground = BrushFromHex("#94A3B8"), Margin = new Thickness(0, 2, 0, 0) };
            srvInfo.Children.Add(activeServerNameText);
            srvInfo.Children.Add(activeServerMetaText);
            Grid.SetColumn(srvInfo, 1);
            srvGrid.Children.Add(srvInfo);

            Border changeBtn = new Border
            {
                Background = BrushFromHex("#1A243D"),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(10, 6, 10, 6),
                VerticalAlignment = VerticalAlignment.Center
            };
            changeBtn.Child = new TextBlock { Text = "Almashtirish ➔", FontSize = 11, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#00F2FE") };
            Grid.SetColumn(changeBtn, 2);
            srvGrid.Children.Add(changeBtn);

            activeServerCard.Child = srvGrid;
            sp.Children.Add(activeServerCard);

            g.Children.Add(sp);
            return g;
        }

        // ================= TAB 2: SERVERS & SUBSCRIPTIONS =================
        private Grid BuildServersTab()
        {
            Grid g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Sub Banner
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Search & Actions
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Auto Fast Card
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Server List

            // 1. Cyber Subscription Card
            Border subCard = new Border
            {
                Background = new LinearGradientBrush(ColorFromHex("#101D38"), ColorFromHex("#1A1235"), 35),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 2, 0, 10)
            };
            StackPanel subSp = new StackPanel();
            Grid subTop = new Grid();
            subTop.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            subTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel subTitles = new StackPanel { Margin = new Thickness(0, 0, 10, 0) };
            subTitleText = new TextBlock { Text = settings.SubName, FontSize = 16, FontWeight = FontWeights.ExtraBold, Foreground = Brushes.White, TextWrapping = TextWrapping.Wrap };
            subMetaText = new TextBlock { Text = "4 ta faol server · VLESS Reality", FontSize = 11, Foreground = BrushFromHex("#93C5FD"), Margin = new Thickness(0, 2, 0, 0), TextWrapping = TextWrapping.Wrap };
            subTitles.Children.Add(subTitleText);
            subTitles.Children.Add(subMetaText);
            subTop.Children.Add(subTitles);

            StackPanel subBtns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            
            // Spinning Refresh Button
            Button btnSync = new Button
            {
                Padding = new Thickness(10, 5, 10, 5),
                Background = BrushFromHex("#172542"),
                Foreground = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand,
                Template = CreateRoundedButtonTemplate(8)
            };
            StackPanel syncContent = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            syncRotateTransform = new RotateTransform(0);
            TextBlock syncIcon = new TextBlock
            {
                Text = "🔄",
                FontSize = 11,
                RenderTransformOrigin = new Point(0.5, 0.5),
                RenderTransform = syncRotateTransform,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 5, 0)
            };
            TextBlock syncText = new TextBlock
            {
                Text = "Yangilash",
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = BrushFromHex("#00F2FE"),
                VerticalAlignment = VerticalAlignment.Center
            };
            syncContent.Children.Add(syncIcon);
            syncContent.Children.Add(syncText);
            btnSync.Content = syncContent;
            btnSync.Click += async (s, e) => await SyncSubscriptionAsync();

            Button btnAdd = CreateActionPillButton("+ Server qo'shish", "#00F2FE", "#04101E");
            btnAdd.Margin = new Thickness(6, 0, 0, 0);
            btnAdd.Click += (s, e) => { modalOverlay.Visibility = Visibility.Visible; };
            subBtns.Children.Add(btnSync);
            subBtns.Children.Add(btnAdd);
            Grid.SetColumn(subBtns, 1);
            subTop.Children.Add(subBtns);
            subSp.Children.Add(subTop);

            subProgressBg = new Border { Height = 6, Background = BrushFromHex("#090D18"), CornerRadius = new CornerRadius(3), Margin = new Thickness(0, 10, 0, 8) };
            subProgressFill = new Border { Height = 6, HorizontalAlignment = HorizontalAlignment.Stretch, Background = BrushFromHex("#00F2FE"), CornerRadius = new CornerRadius(3), RenderTransform = new ScaleTransform(0, 1) };
            subProgressBg.Child = subProgressFill;
            subSp.Children.Add(subProgressBg);

            subStatsGrid = new Grid();
            subUsageText = new TextBlock { Text = "", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = BrushFromHex("#CBD5E1") };
            subDaysText = new TextBlock { Text = "", FontSize = 11, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#10B981"), HorizontalAlignment = HorizontalAlignment.Right };
            subStatsGrid.Children.Add(subUsageText);
            subStatsGrid.Children.Add(subDaysText);
            subSp.Children.Add(subStatsGrid);

            subCard.Child = subSp;
            g.Children.Add(subCard);

            // 2. Search & Ping Bar
            Grid searchGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
            searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Border searchBorder = new Border
            {
                Background = BrushFromHex("#111524"),
                BorderBrush = BrushFromHex("#1F263D"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(10, 6, 10, 6)
            };
            Grid searchWrap = new Grid();
            searchPlaceholder = new TextBlock
            {
                Text = "🔍 Server nomi yoki IP bo'yicha qidirish...",
                Foreground = BrushFromHex("#64748B"),
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(2, 0, 0, 0),
                IsHitTestVisible = false
            };
            searchBox = new TextBox
            {
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Foreground = Brushes.White,
                CaretBrush = Brushes.White,
                FontSize = 12.5,
                Text = ""
            };
            searchBox.TextChanged += (s, e) =>
            {
                searchPlaceholder.Visibility = string.IsNullOrEmpty(searchBox.Text) ? Visibility.Visible : Visibility.Collapsed;
                RenderServerList();
            };
            searchWrap.Children.Add(searchPlaceholder);
            searchWrap.Children.Add(searchBox);
            searchBorder.Child = searchWrap;
            searchGrid.Children.Add(searchBorder);

            Button btnPingAll = CreateActionPillButton("⚡ Ping Test", "#171D30", "#00F2FE");
            btnPingAll.Margin = new Thickness(8, 0, 0, 0);
            btnPingAll.Click += async (s, e) => await PingAllServersAsync();
            Grid.SetColumn(btnPingAll, 1);
            searchGrid.Children.Add(btnPingAll);
            Grid.SetRow(searchGrid, 1);
            g.Children.Add(searchGrid);

            // 3. Auto Select Fastest Server Card
            autoSelectCard = new Border
            {
                Background = BrushFromHex("#121728"),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(12, 10, 12, 10),
                Margin = new Thickness(0, 0, 0, 10),
                Cursor = Cursors.Hand
            };
            autoSelectCard.MouseLeftButtonDown += (s, e) => SelectServer("auto");
            StackPanel autoSp = new StackPanel { Orientation = Orientation.Horizontal };
            Border boltBox = new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(8), Background = BrushFromHex("#162844"), Margin = new Thickness(0, 0, 10, 0) };
            boltBox.Child = new TextBlock { Text = "⚡", FontSize = 15, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            autoSp.Children.Add(boltBox);

            StackPanel autoTxts = new StackPanel();
            autoTxts.Children.Add(new TextBlock { Text = "Avtomatik · Eng Tez Server (Smart Auto)", FontSize = 12.5, FontWeight = FontWeights.Bold, Foreground = Brushes.White });
            autoTxts.Children.Add(new TextBlock { Text = "Eng past pingli serverga ulanadi, uzilsa boshqasiga o'tadi", FontSize = 10.5, Foreground = BrushFromHex("#94A3B8") });
            autoSp.Children.Add(autoTxts);
            autoSelectCard.Child = autoSp;
            Grid.SetRow(autoSelectCard, 2);
            g.Children.Add(autoSelectCard);

            // 4. Scrollable Server List
            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
            serversStack = new StackPanel();
            sv.Content = serversStack;
            Grid.SetRow(sv, 3);
            g.Children.Add(sv);

            return g;
        }

        // ================= TAB 3: ROUTING =================
        private Grid BuildRoutingTab()
        {
            Grid g = new Grid();
            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            StackPanel sp = new StackPanel { Margin = new Thickness(0, 0, 4, 10) };

            // Header Section
            TextBlock title = new TextBlock
            {
                Text = "Marshrutlash Rejimlari (Routing Mode)",
                FontSize = 15,
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                Margin = new Thickness(0, 4, 0, 10)
            };
            sp.Children.Add(title);

            // 1. Smart Bypass Card
            routeCardSmart = new Border
            {
                Background = BrushFromHex("#121D38"),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(14, 12, 14, 12),
                Margin = new Thickness(0, 0, 0, 10),
                Cursor = Cursors.Hand
            };
            routeCardSmart.MouseLeftButtonDown += (s, e) =>
            {
                settings.Routing = "rule";
                SaveData();
                UpdateRoutingUI();
            };

            StackPanel smartSp = new StackPanel();
            Grid smartTop = new Grid();
            smartTop.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            smartTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel smartTitleRow = new StackPanel { Orientation = Orientation.Horizontal };
            smartTitleRow.Children.Add(new TextBlock { Text = "🎯 ", FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
            smartTitleRow.Children.Add(new TextBlock { Text = "Smart Bypass (Aqlli Marshrut)", FontSize = 13, FontWeight = FontWeights.Bold, Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center });
            smartTop.Children.Add(smartTitleRow);

            Border smartBadge = new Border
            {
                Background = BrushFromHex("#064E3B"),
                BorderBrush = BrushFromHex("#10B981"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(8, 2, 8, 2)
            };
            smartBadge.Child = new TextBlock { Text = "TAVSIYA ETILADI", FontSize = 9.5, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#6EE7B7") };
            Grid.SetColumn(smartBadge, 1);
            smartTop.Children.Add(smartBadge);
            smartSp.Children.Add(smartTop);

            TextBlock smartDesc = new TextBlock
            {
                Text = "Lokal tarmoq (LAN, Wi-Fi router, 192.168.x.x, 127.0.0.1) va VPN serverining o'z IP manzili to'g'ridan-to'g'ri (Direct) ulanadi. Faqat tashqi xorijiy saytlar (YouTube, Telegram, Instagram va b.) xavfsiz VLESS tunnellari orqali o'tadi. 'Routing Loop' (aylanma bloklanish) bo'lmaydi va mahalliy banking (Click/Payme) to'siqsiz ishlaydi.",
                FontSize = 11,
                Foreground = BrushFromHex("#94A3B8"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 16,
                Margin = new Thickness(0, 8, 0, 0)
            };
            smartSp.Children.Add(smartDesc);
            routeCardSmart.Child = smartSp;
            sp.Children.Add(routeCardSmart);

            // 2. Global Tunnel Card
            routeCardGlobal = new Border
            {
                Background = BrushFromHex("#0F1322"),
                BorderBrush = BrushFromHex("#1E253D"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(14, 12, 14, 12),
                Margin = new Thickness(0, 0, 0, 14),
                Cursor = Cursors.Hand
            };
            routeCardGlobal.MouseLeftButtonDown += (s, e) =>
            {
                settings.Routing = "global";
                SaveData();
                UpdateRoutingUI();
            };

            StackPanel globSp = new StackPanel();
            Grid globTop = new Grid();
            globTop.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            globTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel globTitleRow = new StackPanel { Orientation = Orientation.Horizontal };
            globTitleRow.Children.Add(new TextBlock { Text = "🌐 ", FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
            globTitleRow.Children.Add(new TextBlock { Text = "Global Tunnel (100% Proksi)", FontSize = 13, FontWeight = FontWeights.Bold, Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center });
            globTop.Children.Add(globTitleRow);

            Border globBadge = new Border
            {
                Background = BrushFromHex("#3B1D54"),
                BorderBrush = BrushFromHex("#A855F7"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(8, 2, 8, 2)
            };
            globBadge.Child = new TextBlock { Text = "TO'LIQ PROKSI", FontSize = 9.5, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#D8B4FE") };
            Grid.SetColumn(globBadge, 1);
            globTop.Children.Add(globBadge);
            globSp.Children.Add(globTop);

            TextBlock globDesc = new TextBlock
            {
                Text = "Kompyuterdagi barcha dasturlar, brauzerlar va tizim internet trafigi istisnosiz 100% VLESS serveri orqali o'tkaziladi. IP manzilni butunlay yashirish kerak bo'lganda qo'llaniladi.",
                FontSize = 11,
                Foreground = BrushFromHex("#94A3B8"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 16,
                Margin = new Thickness(0, 8, 0, 0)
            };
            globSp.Children.Add(globDesc);
            routeCardGlobal.Child = globSp;
            sp.Children.Add(routeCardGlobal);

            // 3. Explanatory Educational Card
            Border infoCard = new Border
            {
                Background = BrushFromHex("#101E2E"),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(14, 12, 14, 12)
            };
            StackPanel iSp = new StackPanel();
            iSp.Children.Add(new TextBlock { Text = "💡 Marshrutlash (Routing) nima va nima uchun kerak?", FontSize = 12.5, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#00F2FE"), Margin = new Thickness(0, 0, 0, 6) });
            iSp.Children.Add(new TextBlock
            {
                Text = "Marshrutlash — internet trafigingiz qaysi yo'l bilan borishini boshqaruvchi qoidalar tizimidir.\n\n• Anti-Loop Himoyasi: sing-box ichida serveringizning haqiqiy IP manzili 'direct' qilib belgilanadi. Bu VPN ulanishining o'z-o'zini bloklab qo'yishining oldini oladi.\n• DoH DNS Himoyasi: Cloudflare 1.1.1.1 shifrlangan DNS orqali sayt so'rovlari oqib ketmaydi (DNS Leak yo'qoladi).\n• Tezlik va qulaylik: Mahalliy saytlar sekinlashmaydi, tashqi bloklangan resurslar esa oson ochiladi.",
                FontSize = 11,
                Foreground = BrushFromHex("#CBD5E1"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 16.5
            });
            infoCard.Child = iSp;
            sp.Children.Add(infoCard);

            sv.Content = sp;
            g.Children.Add(sv);
            UpdateRoutingUI();
            return g;
        }

        private void UpdateRoutingUI()
        {
            if (routeCardSmart == null || routeCardGlobal == null) return;
            bool isRule = (settings.Routing == "rule");
            routeCardSmart.BorderBrush = BrushFromHex(isRule ? "#00F2FE" : "#1E253D");
            routeCardSmart.Background = BrushFromHex(isRule ? "#121D38" : "#0F1322");
            routeCardSmart.BorderThickness = new Thickness(isRule ? 1.5 : 1);

            routeCardGlobal.BorderBrush = BrushFromHex(!isRule ? "#00F2FE" : "#1E253D");
            routeCardGlobal.Background = BrushFromHex(!isRule ? "#121D38" : "#0F1322");
            routeCardGlobal.BorderThickness = new Thickness(!isRule ? 1.5 : 1);
        }

        // ================= TAB 4: SETTINGS =================
        private Grid BuildSettingsTab()
        {
            Grid g = new Grid();
            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            StackPanel sp = new StackPanel { Margin = new Thickness(0, 0, 4, 10) };

            // Title
            sp.Children.Add(new TextBlock
            {
                Text = "Dastur va Tarmoq Sozlamalari",
                FontSize = 15,
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                Margin = new Thickness(0, 4, 0, 10)
            });

            // Card 1: Ulanish Rejimi (Traffic Mode)
            Border modeCard = new Border
            {
                Background = BrushFromHex("#111524"),
                BorderBrush = BrushFromHex("#1E253D"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(14, 12, 14, 12),
                Margin = new Thickness(0, 0, 0, 10)
            };
            StackPanel modeSp = new StackPanel();
            modeSp.Children.Add(new TextBlock { Text = "1. Ulanish Rejimi (Traffic Redirection)", FontSize = 13, FontWeight = FontWeights.Bold, Foreground = Brushes.White, Margin = new Thickness(0, 0, 0, 8) });

            // Mode Option A: System Proxy
            modeCardProxy = new Border
            {
                Background = BrushFromHex("#121D38"),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(12, 10, 12, 10),
                Margin = new Thickness(0, 0, 0, 8),
                Cursor = Cursors.Hand
            };
            modeCardProxy.MouseLeftButtonDown += (s, e) =>
            {
                settings.Mode = "system_proxy";
                SaveData();
                UpdateModeUI();
                RefreshAllUI();
            };
            StackPanel prxSp = new StackPanel();
            Grid prxTop = new Grid();
            prxTop.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            prxTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            prxTop.Children.Add(new TextBlock { Text = "⚡ System Proxy (127.0.0.1:20807)", FontSize = 12.5, FontWeight = FontWeights.Bold, Foreground = Brushes.White });
            Border prxBadge = new Border { Background = BrushFromHex("#0F2942"), BorderBrush = BrushFromHex("#00F2FE"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(6, 2, 6, 2) };
            prxBadge.Child = new TextBlock { Text = "ADMINSIZ / TEZKOR", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#00F2FE") };
            Grid.SetColumn(prxBadge, 1);
            prxTop.Children.Add(prxBadge);
            prxSp.Children.Add(prxTop);
            prxSp.Children.Add(new TextBlock
            {
                Text = "Windows tizim proksisi orqali ulaydi. Brauzerlar, Telegram va asosiy ilovalar darhol ishlaydi. Administrator huquqini talab qilmaydi.",
                FontSize = 10.5,
                Foreground = BrushFromHex("#94A3B8"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0)
            });
            modeCardProxy.Child = prxSp;
            modeSp.Children.Add(modeCardProxy);

            // Mode Option B: TUN Mode
            modeCardTun = new Border
            {
                Background = BrushFromHex("#0F1322"),
                BorderBrush = BrushFromHex("#1E253D"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(12, 10, 12, 10),
                Cursor = Cursors.Hand
            };
            modeCardTun.MouseLeftButtonDown += (s, e) =>
            {
                settings.Mode = "tun";
                SaveData();
                UpdateModeUI();
                RefreshAllUI();
            };
            StackPanel tunSp = new StackPanel();
            Grid tunTop = new Grid();
            tunTop.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            tunTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            tunTop.Children.Add(new TextBlock { Text = "🛡️ TUN Rejimi (WinTun Virtual VPN Adapter)", FontSize = 12.5, FontWeight = FontWeights.Bold, Foreground = Brushes.White });
            Border tunBadge = new Border { Background = BrushFromHex("#3B1D54"), BorderBrush = BrushFromHex("#A855F7"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(6, 2, 6, 2) };
            tunBadge.Child = new TextBlock { Text = "TO'LIQ TIZIM / ADMIN", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#D8B4FE") };
            Grid.SetColumn(tunBadge, 1);
            tunTop.Children.Add(tunBadge);
            tunSp.Children.Add(tunTop);
            tunSp.Children.Add(new TextBlock
            {
                Text = "Tizim darajasidagi virtual tarmoq adapteri. Barcha o'yinlar, buyruqlar satri va proksini qo'llab-quvvatlamaydigan dasturlarni 100% qamrab oladi. (Administrator huquqi talab qilinadi).",
                FontSize = 10.5,
                Foreground = BrushFromHex("#94A3B8"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0)
            });
            modeCardTun.Child = tunSp;
            modeSp.Children.Add(modeCardTun);

            modeCard.Child = modeSp;
            sp.Children.Add(modeCard);

            // Card 2: Barqarorlik va Tarmoq Himoyasi (Watchdog & MTU)
            Border stabCard = new Border
            {
                Background = BrushFromHex("#111524"),
                BorderBrush = BrushFromHex("#1E253D"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(14, 12, 14, 12),
                Margin = new Thickness(0, 0, 0, 10)
            };
            StackPanel stabSp = new StackPanel();
            stabSp.Children.Add(new TextBlock { Text = "2. Barqarorlik va Tarmoq Himoyasi", FontSize = 13, FontWeight = FontWeights.Bold, Foreground = Brushes.White, Margin = new Thickness(0, 0, 0, 8) });

            chkWatchdog = new CheckBox
            {
                Content = "Auto-Reconnect Watchdog (Uzilganda avtomatik qayta ulash)",
                Foreground = Brushes.White,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                IsChecked = settings.Watchdog,
                Margin = new Thickness(0, 2, 0, 2)
            };
            chkWatchdog.Checked += (s, e) => { settings.Watchdog = true; SaveData(); };
            chkWatchdog.Unchecked += (s, e) => { settings.Watchdog = false; SaveData(); };
            stabSp.Children.Add(chkWatchdog);
            stabSp.Children.Add(new TextBlock
            {
                Text = "Har 5 soniyada ulanish holatini tekshiradi. Agar internet uzilib-yonsa yoki server javob bermasa, 3 soniyada avtomatik qayta ulaydi.",
                FontSize = 10.5,
                Foreground = BrushFromHex("#94A3B8"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(22, 2, 0, 10)
            });

            StackPanel mtuRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 4) };
            mtuRow.Children.Add(new TextBlock { Text = "Optimal MTU Hajmi: ", FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center });
            cmbMtu = new ComboBox { Width = 190, FontSize = 12, Margin = new Thickness(10, 0, 0, 0) };
            cmbMtu.Items.Add("1400 (Optimal - Tavsiya)");
            cmbMtu.Items.Add("1280 (Sekin / Mobil tarmoq)");
            cmbMtu.Items.Add("1500 (Standart Provayder)");
            cmbMtu.SelectedIndex = (settings.Mtu == 1280) ? 1 : (settings.Mtu == 1500 ? 2 : 0);
            cmbMtu.SelectionChanged += (s, e) =>
            {
                if (cmbMtu.SelectedIndex == 0) settings.Mtu = 1400;
                else if (cmbMtu.SelectedIndex == 1) settings.Mtu = 1280;
                else settings.Mtu = 1500;
                SaveData();
            };
            mtuRow.Children.Add(cmbMtu);
            stabSp.Children.Add(mtuRow);
            stabSp.Children.Add(new TextBlock
            {
                Text = "VLESS Reality TLS shifrlash qo'shimcha sarlavha qo'shadi. 1400 MTU paketlar maydalanib ketishining va ulanish uzilishining oldini oladi.",
                FontSize = 10.5,
                Foreground = BrushFromHex("#94A3B8"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0)
            });

            stabCard.Child = stabSp;
            sp.Children.Add(stabCard);

            // Card 3: Antivirus Istisnolari (Avast Alert)
            Border avCard = new Border
            {
                Background = BrushFromHex("#231B12"),
                BorderBrush = BrushFromHex("#F59E0B"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(14, 12, 14, 12)
            };
            StackPanel avSp = new StackPanel();
            avSp.Children.Add(new TextBlock { Text = "⚠️ Avast / Antivirus bo'yicha muhim eslatma", FontSize = 12.5, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#FBBF24"), Margin = new Thickness(0, 0, 0, 4) });
            avSp.Children.Add(new TextBlock
            {
                Text = "Kompyuteringizda Avast o'rnatilgan. Agar Avast'ning 'HTTPS Scanning / Web Shield' funksiyasi VLESS Reality paketlarini tekshirsa, aloqa soxtalashtirilgan deb hisoblanib uzilib qolishi mumkin.\n\nTavsiya: Avast sozlamalaridan ushbu ZedRay papkasini Exclusions (Istisnolar) ro'yxatiga qo'shing.",
                FontSize = 11,
                Foreground = BrushFromHex("#FDE68A"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 16
            });
            avCard.Child = avSp;
            sp.Children.Add(avCard);

            sv.Content = sp;
            g.Children.Add(sv);
            UpdateModeUI();
            return g;
        }

        private void UpdateModeUI()
        {
            if (modeCardProxy == null || modeCardTun == null) return;
            bool isTun = (settings.Mode == "tun");
            modeCardProxy.BorderBrush = BrushFromHex(!isTun ? "#00F2FE" : "#1E253D");
            modeCardProxy.Background = BrushFromHex(!isTun ? "#121D38" : "#0F1322");
            modeCardProxy.BorderThickness = new Thickness(!isTun ? 1.5 : 1);

            modeCardTun.BorderBrush = BrushFromHex(isTun ? "#00F2FE" : "#1E253D");
            modeCardTun.Background = BrushFromHex(isTun ? "#121D38" : "#0F1322");
            modeCardTun.BorderThickness = new Thickness(isTun ? 1.5 : 1);
        }

        // ================= MODAL OVERLAY (ADD SERVER / SUB) =================
        private Grid BuildModalOverlay()
        {
            Grid overlay = new Grid
            {
                Background = new SolidColorBrush(Color.FromArgb(210, 5, 7, 14)),
                Visibility = Visibility.Collapsed
            };

            Border box = new Border
            {
                Width = 390,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                Background = BrushFromHex("#111626"),
                BorderBrush = BrushFromHex("#00F2FE"),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(18),
                Padding = new Thickness(18),
                Effect = new DropShadowEffect { Color = Colors.Black, BlurRadius = 30 }
            };

            StackPanel sp = new StackPanel();
            Grid top = new Grid { Margin = new Thickness(0, 0, 0, 12) };
            top.Children.Add(new TextBlock { Text = "Server yoki Obuna Qo'shish", FontSize = 16, FontWeight = FontWeights.ExtraBold, Foreground = Brushes.White });
            Button closeBtn = CreateActionPillButton("✕ Yopish", "#281926", "#F87171");
            closeBtn.HorizontalAlignment = HorizontalAlignment.Right;
            closeBtn.Click += (s, e) => overlay.Visibility = Visibility.Collapsed;
            top.Children.Add(closeBtn);
            sp.Children.Add(top);

            // Section 1: VLESS Link
            sp.Children.Add(new TextBlock { Text = "1. VLESS Reality Havolasi (vless://...):", FontSize = 11.5, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#00F2FE"), Margin = new Thickness(0, 0, 0, 4) });
            txtVlessLink = new TextBox
            {
                Height = 56,
                TextWrapping = TextWrapping.Wrap,
                Background = BrushFromHex("#090C15"),
                Foreground = Brushes.White,
                CaretBrush = Brushes.White,
                BorderBrush = BrushFromHex("#242D4A"),
                FontSize = 11.5,
                Padding = new Thickness(8),
                Margin = new Thickness(0, 0, 0, 8)
            };
            sp.Children.Add(txtVlessLink);

            StackPanel linkBtns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 16) };
            Button pasteLinkBtn = CreateActionPillButton("📋 Xotiradan joylash (Paste)", "#182238", "#93C5FD");
            pasteLinkBtn.Click += (s, e) => { if (Clipboard.ContainsText()) txtVlessLink.Text = Clipboard.GetText().Trim(); };
            Button saveLinkBtn = CreateActionPillButton("✓ Serverni Saqlash", "#00F2FE", "#04101E");
            saveLinkBtn.Margin = new Thickness(8, 0, 0, 0);
            saveLinkBtn.Click += (s, e) => AddVlessLinkFromModal();
            linkBtns.Children.Add(pasteLinkBtn);
            linkBtns.Children.Add(saveLinkBtn);
            sp.Children.Add(linkBtns);

            // Section 2: Subscription URL
            sp.Children.Add(new TextBlock { Text = "2. Yoki Obuna (Subscription URL) qo'shish:", FontSize = 11.5, FontWeight = FontWeights.Bold, Foreground = BrushFromHex("#A855F7"), Margin = new Thickness(0, 0, 0, 4) });
            txtSubName = new TextBox
            {
                Text = settings.SubName,
                Background = BrushFromHex("#090C15"),
                Foreground = Brushes.White,
                CaretBrush = Brushes.White,
                BorderBrush = BrushFromHex("#242D4A"),
                FontSize = 12,
                Padding = new Thickness(8, 5, 8, 5),
                Margin = new Thickness(0, 0, 0, 6)
            };
            sp.Children.Add(txtSubName);

            txtSubUrl = new TextBox
            {
                Text = settings.SubUrl,
                Background = BrushFromHex("#090C15"),
                Foreground = Brushes.White,
                CaretBrush = Brushes.White,
                BorderBrush = BrushFromHex("#242D4A"),
                FontSize = 11.5,
                Padding = new Thickness(8, 5, 8, 5),
                Margin = new Thickness(0, 0, 0, 8)
            };
            sp.Children.Add(txtSubUrl);

            StackPanel subBtns = new StackPanel { Orientation = Orientation.Horizontal };
            Button pasteSubBtn = CreateActionPillButton("📋 URL Paste", "#182238", "#93C5FD");
            pasteSubBtn.Click += (s, e) => { if (Clipboard.ContainsText()) txtSubUrl.Text = Clipboard.GetText().Trim(); };
            Button saveSubBtn = CreateActionPillButton("🔄 Obunani Yuklash", "#A855F7", "#FFFFFF");
            saveSubBtn.Margin = new Thickness(8, 0, 0, 0);
            saveSubBtn.Click += async (s, e) =>
            {
                settings.SubName = txtSubName.Text.Trim();
                settings.SubUrl = txtSubUrl.Text.Trim();
                SaveData();
                overlay.Visibility = Visibility.Collapsed;
                await SyncSubscriptionAsync();
            };
            subBtns.Children.Add(pasteSubBtn);
            subBtns.Children.Add(saveSubBtn);
            sp.Children.Add(subBtns);

            box.Child = sp;
            overlay.Children.Add(box);
            return overlay;
        }

        // ================= FLAG VECTOR RENDERER =================
        private UIElement CreateFlagBadge(string codeOrName)
        {
            string c = (codeOrName ?? "").ToUpperInvariant();
            Border b = new Border { Width = 36, Height = 24, CornerRadius = new CornerRadius(5), ClipToBounds = true, BorderBrush = BrushFromHex("#2D3748"), BorderThickness = new Thickness(0.5) };
            Canvas cv = new Canvas { Width = 36, Height = 24 };

            if (c.Contains("HK") || c.Contains("HONG"))
            {
                cv.Background = BrushFromHex("#DE2910");
                Ellipse flower = new Ellipse { Width = 10, Height = 10, Fill = Brushes.White };
                Canvas.SetLeft(flower, 13); Canvas.SetTop(flower, 7);
                cv.Children.Add(flower);
            }
            else if (c.Contains("EU") || c.Contains("EURO"))
            {
                cv.Background = BrushFromHex("#003399");
                Ellipse ring = new Ellipse { Width = 14, Height = 14, Stroke = BrushFromHex("#FFCC00"), StrokeThickness = 2, StrokeDashArray = new DoubleCollection { 1, 1.2 } };
                Canvas.SetLeft(ring, 11); Canvas.SetTop(ring, 5);
                cv.Children.Add(ring);
            }
            else if (c.Contains("DE") || c.Contains("GERM"))
            {
                StackPanel sp = new StackPanel();
                sp.Children.Add(new Border { Width = 36, Height = 8, Background = Brushes.Black });
                sp.Children.Add(new Border { Width = 36, Height = 8, Background = BrushFromHex("#DD0000") });
                sp.Children.Add(new Border { Width = 36, Height = 8, Background = BrushFromHex("#FFCE00") });
                b.Child = sp;
                return b;
            }
            else if (c.Contains("US") || c.Contains("AMER") || c.Contains("UNITED"))
            {
                cv.Background = BrushFromHex("#B22234");
                cv.Children.Add(new Rectangle { Width = 36, Height = 4, Fill = Brushes.White, Margin = new Thickness(0, 4, 0, 0) });
                cv.Children.Add(new Rectangle { Width = 36, Height = 4, Fill = Brushes.White, Margin = new Thickness(0, 12, 0, 0) });
                cv.Children.Add(new Rectangle { Width = 36, Height = 4, Fill = Brushes.White, Margin = new Thickness(0, 20, 0, 0) });
                cv.Children.Add(new Rectangle { Width = 16, Height = 13, Fill = BrushFromHex("#3C3B6E") });
            }
            else if (c.Contains("SG") || c.Contains("SING"))
            {
                StackPanel sp = new StackPanel();
                sp.Children.Add(new Border { Width = 36, Height = 12, Background = BrushFromHex("#EF3340") });
                sp.Children.Add(new Border { Width = 36, Height = 12, Background = Brushes.White });
                b.Child = sp;
                return b;
            }
            else if (c.Contains("JP") || c.Contains("JAP"))
            {
                cv.Background = Brushes.White;
                Ellipse sun = new Ellipse { Width = 12, Height = 12, Fill = BrushFromHex("#BC002D") };
                Canvas.SetLeft(sun, 12); Canvas.SetTop(sun, 6);
                cv.Children.Add(sun);
            }
            else if (c.Contains("RU") || c.Contains("RUSS"))
            {
                StackPanel sp = new StackPanel();
                sp.Children.Add(new Border { Width = 36, Height = 8, Background = Brushes.White });
                sp.Children.Add(new Border { Width = 36, Height = 8, Background = BrushFromHex("#0039A6") });
                sp.Children.Add(new Border { Width = 36, Height = 8, Background = BrushFromHex("#D52B1E") });
                b.Child = sp;
                return b;
            }
            else
            {
                cv.Background = BrushFromHex("#0F2942");
                Ellipse globe = new Ellipse { Width = 14, Height = 14, Stroke = BrushFromHex("#00F2FE"), StrokeThickness = 1.5 };
                Canvas.SetLeft(globe, 11); Canvas.SetTop(globe, 5);
                cv.Children.Add(globe);
            }

            b.Child = cv;
            return b;
        }

        // ================= RENDERING & UI UPDATES =================
        private void RefreshAllUI()
        {
            modeBadgeText.Text = (settings.Mode == "tun") ? "TUN (TO'LIQ VPN)" : "SYSTEM PROXY";
            bool hasSub = !string.IsNullOrEmpty(settings.SubUrl);
            bool hasQuota = hasSub && settings.TotalGb > 0;
            if (hasSub)
            {
                subTitleText.Text = string.IsNullOrEmpty(settings.SubName) ? "Obuna" : settings.SubName;
                subMetaText.Text = string.Format("{0} ta server obunadan", servers.Count(s => s.Source == "subscription"));
                subUsageText.Text = string.Format("{0:0.00} GB / {1:0.##} GB", settings.UsedGb, settings.TotalGb);
                subDaysText.Text = settings.DaysLeft > 0 ? string.Format("{0} kun qoldi", settings.DaysLeft) : "Muddatsiz";
                double ratio = hasQuota ? Math.Min(1.0, settings.UsedGb / settings.TotalGb) : 0;
                subProgressFill.RenderTransform = new ScaleTransform(ratio, 1);
            }
            else
            {
                subTitleText.Text = "Obuna qo'shilmagan";
                subMetaText.Text = servers.Count > 0
                    ? string.Format("{0} ta server qo'lda qo'shilgan", servers.Count)
                    : "Boshlash uchun «+ Server qo'shish» ni bosing";
            }
            subProgressBg.Visibility = hasQuota ? Visibility.Visible : Visibility.Collapsed;
            subStatsGrid.Visibility = hasQuota ? Visibility.Visible : Visibility.Collapsed;

            RenderServerList();
            UpdateActiveServerPreview();
            UpdateConnectionVisuals();
            UpdateRoutingUI();
            UpdateModeUI();
        }

        private void RenderServerList()
        {
            if (serversStack == null) return;
            serversStack.Children.Clear();

            autoSelectCard.Visibility = servers.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
            if (servers.Count == 0)
            {
                Border empty = new Border
                {
                    Background = BrushFromHex("#0F1320"),
                    BorderBrush = BrushFromHex("#242D4A"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(14),
                    Padding = new Thickness(18, 22, 18, 22)
                };
                StackPanel es = new StackPanel();
                es.Children.Add(new TextBlock { Text = "Hali server qo'shilmagan", FontSize = 14, FontWeight = FontWeights.Bold, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center });
                es.Children.Add(new TextBlock
                {
                    Text = "Yuqoridagi «+ Server qo'shish» tugmasini bosing va vless:// havolangizni yoki obuna URL'ingizni kiriting.",
                    FontSize = 11.5, Foreground = BrushFromHex("#94A3B8"), TextWrapping = TextWrapping.Wrap,
                    TextAlignment = TextAlignment.Center, Margin = new Thickness(0, 6, 0, 0)
                });
                empty.Child = es;
                serversStack.Children.Add(empty);
                return;
            }

            autoSelectCard.BorderBrush = (settings.SelectedServerId == "auto") ? BrushFromHex("#00F2FE") : BrushFromHex("#1F263D");
            autoSelectCard.Background = (settings.SelectedServerId == "auto") ? BrushFromHex("#132038") : BrushFromHex("#111524");

            string q = (searchBox != null && searchBox.Text != null) ? searchBox.Text.Trim().ToLowerInvariant() : "";

            foreach (var srv in servers)
            {
                if (!string.IsNullOrEmpty(q) && !srv.Name.ToLowerInvariant().Contains(q) && !srv.Host.ToLowerInvariant().Contains(q))
                    continue;

                bool selected = (settings.SelectedServerId == srv.Id);
                Border item = new Border
                {
                    Background = selected ? BrushFromHex("#14223D") : BrushFromHex("#111524"),
                    BorderBrush = selected ? BrushFromHex("#00F2FE") : BrushFromHex("#1E253D"),
                    BorderThickness = new Thickness(selected ? 1.5 : 1),
                    CornerRadius = new CornerRadius(14),
                    Padding = new Thickness(12, 10, 12, 10),
                    Margin = new Thickness(0, 0, 0, 8),
                    Cursor = Cursors.Hand
                };

                Grid g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                UIElement flag = CreateFlagBadge(srv.Country + " " + srv.Name);
                Grid flagWrap = new Grid { Margin = new Thickness(0, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
                flagWrap.Children.Add(flag);
                g.Children.Add(flagWrap);

                StackPanel mid = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                mid.Children.Add(new TextBlock { Text = srv.Name, FontSize = 13, FontWeight = FontWeights.Bold, Foreground = Brushes.White });
                mid.Children.Add(new TextBlock
                {
                    Text = string.Format("VLESS · {0} / {1} · {2}", (srv.Network ?? "TCP").ToUpper(), (srv.Security ?? "REALITY").ToUpper(), srv.Host),
                    FontSize = 10.5,
                    Foreground = BrushFromHex("#94A3B8"),
                    Margin = new Thickness(0, 2, 0, 0)
                });
                Grid.SetColumn(mid, 1);
                g.Children.Add(mid);

                StackPanel right = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                string pingStr = (srv.Ping > 0) ? (srv.Ping + " ms") : (srv.Ping < 0 ? "Timeout" : "—");
                string pingColor = (srv.Ping <= 0) ? "#64748B" : (srv.Ping < 100 ? "#10B981" : (srv.Ping < 220 ? "#F59E0B" : "#EF4444"));

                Border pingBadge = new Border
                {
                    Background = BrushFromHex("#0B0E18"),
                    BorderBrush = BrushFromHex(pingColor),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(8, 3, 8, 3),
                    Margin = new Thickness(0, 0, 6, 0)
                };
                pingBadge.Child = new TextBlock { Text = pingStr, FontSize = 11, FontWeight = FontWeights.Bold, Foreground = BrushFromHex(pingColor) };
                right.Children.Add(pingBadge);

                string srvId = srv.Id;
                Button delBtn = CreateIconButton("✕", "#1B1626", "#94A3B8");
                delBtn.Width = 26; delBtn.Height = 26;
                delBtn.Click += (s, e) =>
                {
                    e.Handled = true;
                    servers.RemoveAll(x => x.Id == srvId);
                    SaveData();
                    RefreshAllUI();
                };
                right.Children.Add(delBtn);

                Grid.SetColumn(right, 2);
                g.Children.Add(right);

                item.Child = g;
                item.MouseLeftButtonDown += (s, e) => SelectServer(srvId);
                serversStack.Children.Add(item);
            }
        }

        private void SelectServer(string id)
        {
            settings.SelectedServerId = id;
            SaveData();
            RefreshAllUI();
            if (isConnected)
            {
                DisconnectVpn();
                ConnectVpn();
            }
        }

        private ServerItem GetTargetServer()
        {
            if (servers.Count == 0) return null;
            if (settings.SelectedServerId == "auto" || string.IsNullOrEmpty(settings.SelectedServerId))
            {
                var reachable = servers.Where(s => s.Ping > 0).OrderBy(s => s.Ping).FirstOrDefault();
                return reachable ?? servers[0];
            }
            return servers.FirstOrDefault(s => s.Id == settings.SelectedServerId) ?? servers[0];
        }

        private void UpdateActiveServerPreview()
        {
            ServerItem target = activeServer ?? GetTargetServer();
            if (target == null)
            {
                activeFlagContainer.Children.Clear();
                activeServerNameText.Text = "Server tanlanmagan";
                activeServerMetaText.Text = "Serverlar bo'limidan VLESS link qo'shing";
                return;
            }

            activeFlagContainer.Children.Clear();
            activeFlagContainer.Children.Add(CreateFlagBadge(target.Country + " " + target.Name));
            activeServerNameText.Text = (settings.SelectedServerId == "auto") ? ("Auto · " + target.Name) : target.Name;
            activeServerMetaText.Text = string.Format("VLESS · {0} · {1}", (target.Security ?? "REALITY").ToUpper(),
                target.Ping > 0 ? (target.Ping + " ms") : (target.Ping < 0 ? "Timeout" : "ping o'lchanmagan"));
        }

        // ================= VPN CORE ENGINE (SING-BOX) =================
        private void ToggleConnection()
        {
            if (isConnected || isConnecting)
                DisconnectVpn();
            else
                ConnectVpn();
        }

        private async void ConnectVpn()
        {
            ServerItem target = GetTargetServer();
            if (target == null)
            {
                MessageBox.Show("Hech qanday server topilmadi! Serverlar bo'limidan VLESS link qo'shing.", "ZedRay", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            isConnecting = true;
            activeServer = target;
            UpdateConnectionVisuals();

            await Task.Run(() =>
            {
                try
                {
                    StopExistingSingbox();
                    string configJson = GenerateSingboxJson(target);
                    File.WriteAllText(runtimeConfigFile, configJson, new UTF8Encoding(false));

                    string singboxExe = System.IO.Path.Combine(binDir, "sing-box.exe");
                    if (!File.Exists(singboxExe)) singboxExe = "sing-box.exe";

                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = singboxExe,
                        Arguments = "run -c \"" + runtimeConfigFile + "\"",
                        WorkingDirectory = binDir,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };

                    singboxProcess = Process.Start(psi);
                    System.Threading.Thread.Sleep(600);

                    if (settings.Mode == "system_proxy")
                    {
                        SetWindowsSystemProxy(true, "127.0.0.1:20807");
                    }

                    isConnected = true;
                    isConnecting = false;
                    connectStartTime = DateTime.Now;
                }
                catch (Exception ex)
                {
                    isConnected = false;
                    isConnecting = false;
                    Dispatcher.Invoke(() => MessageBox.Show("Ulanish xatosi: " + ex.Message, "ZedRay Error", MessageBoxButton.OK, MessageBoxImage.Error));
                }
            });

            UpdateConnectionVisuals();
            UpdateActiveServerPreview();
        }

        private void DisconnectVpn()
        {
            isConnected = false;
            isConnecting = false;
            activeServer = null;
            SetWindowsSystemProxy(false, "");
            StopExistingSingbox();
            UpdateConnectionVisuals();
            UpdateActiveServerPreview();
        }

        private void StopExistingSingbox()
        {
            try
            {
                if (singboxProcess != null && !singboxProcess.HasExited)
                {
                    singboxProcess.Kill();
                    singboxProcess = null;
                }
            }
            catch { }
        }

        private void SetWindowsSystemProxy(bool enable, string proxyAddr)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true))
                {
                    if (key != null)
                    {
                        key.SetValue("ProxyEnable", enable ? 1 : 0, RegistryValueKind.DWord);
                        if (enable && !string.IsNullOrEmpty(proxyAddr))
                            key.SetValue("ProxyServer", proxyAddr, RegistryValueKind.String);
                    }
                }
            }
            catch { }
        }

        private string GenerateSingboxJson(ServerItem srv)
        {
            string resolvedIp = srv.Host;
            try
            {
                IPAddress[] ips = Dns.GetHostAddresses(srv.Host);
                if (ips.Length > 0) resolvedIp = ips[0].ToString();
            }
            catch { }

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"log\": { \"level\": \"warn\" },");
            sb.AppendLine("  \"dns\": {");
            sb.AppendLine("    \"servers\": [");
            sb.AppendLine("      { \"tag\": \"dns-remote\", \"address\": \"https://1.1.1.1/dns-query\", \"detour\": \"proxy\" },");
            sb.AppendLine("      { \"tag\": \"dns-direct\", \"address\": \"local\", \"detour\": \"direct\" }");
            sb.AppendLine("    ],");
            sb.AppendLine("    \"rules\": [ { \"outbound\": \"any\", \"server\": \"dns-direct\" } ],");
            sb.AppendLine("    \"strategy\": \"ipv4_only\"");
            sb.AppendLine("  },");
            sb.AppendLine("  \"inbounds\": [");
            sb.AppendLine("    { \"type\": \"mixed\", \"tag\": \"mixed-in\", \"listen\": \"127.0.0.1\", \"listen_port\": 20807 }" + (settings.Mode == "tun" ? "," : ""));
            if (settings.Mode == "tun")
            {
                sb.AppendLine("    { \"type\": \"tun\", \"tag\": \"tun-in\", \"interface_name\": \"ZedRayTun\", \"inet4_address\": \"172.19.0.1/30\", \"mtu\": " + settings.Mtu + ", \"auto_route\": true, \"strict_route\": true, \"stack\": \"gvisor\", \"sniff\": true }");
            }
            sb.AppendLine("  ],");
            sb.AppendLine("  \"outbounds\": [");
            sb.AppendLine("    {");
            sb.AppendLine("      \"type\": \"vless\",");
            sb.AppendLine("      \"tag\": \"proxy\",");
            sb.AppendLine("      \"server\": \"" + EscapeJson(srv.Host) + "\",");
            sb.AppendLine("      \"server_port\": " + srv.Port + ",");
            sb.AppendLine("      \"uuid\": \"" + EscapeJson(srv.Uuid) + "\",");
            if (!string.IsNullOrEmpty(srv.Flow))
                sb.AppendLine("      \"flow\": \"" + EscapeJson(srv.Flow) + "\",");
            sb.AppendLine("      \"network\": \"tcp\",");
            sb.AppendLine("      \"tls\": {");
            sb.AppendLine("        \"enabled\": true,");
            sb.AppendLine("        \"server_name\": \"" + EscapeJson(string.IsNullOrEmpty(srv.Sni) ? srv.Host : srv.Sni) + "\",");
            sb.AppendLine("        \"utls\": { \"enabled\": true, \"fingerprint\": \"" + EscapeJson(string.IsNullOrEmpty(srv.Fingerprint) ? "chrome" : srv.Fingerprint) + "\" },");
            sb.AppendLine("        \"reality\": { \"enabled\": true, \"public_key\": \"" + EscapeJson(srv.PublicKey) + "\", \"short_id\": \"" + EscapeJson(srv.ShortId) + "\" }");
            sb.AppendLine("      }");
            sb.AppendLine("    },");
            sb.AppendLine("    { \"type\": \"direct\", \"tag\": \"direct\" },");
            sb.AppendLine("    { \"type\": \"dns\", \"tag\": \"dns-out\" }");
            sb.AppendLine("  ],");
            sb.AppendLine("  \"route\": {");
            sb.AppendLine("    \"rules\": [");
            sb.AppendLine("      { \"protocol\": \"dns\", \"outbound\": \"dns-out\" },");
            sb.AppendLine("      { \"ip_cidr\": [ \"" + resolvedIp + "/32\" ], \"outbound\": \"direct\" },");
            sb.AppendLine("      { \"ip_is_private\": true, \"outbound\": \"direct\" }");
            sb.AppendLine("    ],");
            sb.AppendLine("    \"auto_detect_interface\": true,");
            sb.AppendLine("    \"final\": \"proxy\"");
            sb.AppendLine("  }");
            sb.AppendLine("}");
            return sb.ToString();
        }

        private void UpdateConnectionVisuals()
        {
            if (isConnected)
            {
                headerStatusDot.Fill = BrushFromHex("#10B981");
                headerStatusText.Text = "HIMOYALANGAN";
                headerStatusText.Foreground = BrushFromHex("#10B981");

                securityCard.BorderBrush = BrushFromHex("#10B981");
                secTitleText.Text = "HIMOYA YOQILGAN · VLESS REALITY";
                secTitleText.Foreground = BrushFromHex("#10B981");
                secSubText.Text = "Shifrlangan kanal: " + (activeServer != null ? activeServer.Host : "Faol") + " · MTU " + settings.Mtu;

                outerGlowRing.Stroke = BrushFromHex("#00F2FE");
                powerBtnBorder.Background = new LinearGradientBrush(ColorFromHex("#00F2FE"), ColorFromHex("#2563EB"), 45);
                powerBtnBorder.BorderBrush = BrushFromHex("#7DD3FC");
                powerBtnLabel.Text = "UZISH";
            }
            else if (isConnecting)
            {
                headerStatusDot.Fill = BrushFromHex("#F59E0B");
                headerStatusText.Text = "ULANMOQDA...";
                headerStatusText.Foreground = BrushFromHex("#F59E0B");

                secTitleText.Text = "TUNNEL OCHILMOQDA...";
                secTitleText.Foreground = BrushFromHex("#F59E0B");
                powerBtnLabel.Text = "KUTING...";
            }
            else
            {
                headerStatusDot.Fill = BrushFromHex("#64748B");
                headerStatusText.Text = "O'CHIRILGAN";
                headerStatusText.Foreground = BrushFromHex("#94A3B8");

                securityCard.BorderBrush = BrushFromHex("#1E253D");
                secTitleText.Text = "HIMOYA O'CHIRILGAN";
                secTitleText.Foreground = BrushFromHex("#94A3B8");
                secSubText.Text = "Tarmoq ochiq · Ulash uchun pastdagi tugmani bosing";

                outerGlowRing.Stroke = BrushFromHex("#1E263D");
                powerBtnBorder.Background = new LinearGradientBrush(ColorFromHex("#171C2E"), ColorFromHex("#0F1320"), 45);
                powerBtnBorder.BorderBrush = BrushFromHex("#2A3454");
                powerBtnLabel.Text = "ULASH";
                timerText.Text = "00:00:00";
                speedDownText.Text = "0.0 MB/s";
                speedUpText.Text = "0.0 MB/s";
            }
        }

        // ================= TIMERS & LIVE SPEED GRAPH =================
        private void SetupTimers()
        {
            uiTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            uiTimer.Tick += (s, e) =>
            {
                double dl, ul;
                MeasureRealThroughput(out dl, out ul);
                if (isConnected)
                {
                    TimeSpan elapsed = DateTime.Now - connectStartTime;
                    timerText.Text = elapsed.ToString(@"hh\:mm\:ss");
                    speedDownText.Text = dl.ToString("0.0") + " MB/s";
                    speedUpText.Text = ul.ToString("0.0") + " MB/s";

                    speedHistory.RemoveAt(0);
                    speedHistory.Add(dl);
                }
                else
                {
                    speedHistory.RemoveAt(0);
                    speedHistory.Add(0);
                }
                DrawSpeedGraph();
            };
            uiTimer.Start();

            watchdogTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
            watchdogTimer.Tick += async (s, e) =>
            {
                if (!isConnected || !settings.Watchdog || activeServer == null) return;
                int ping = await TestTcpPingAsync(activeServer.Host, activeServer.Port, 2500);
                if (ping <= 0)
                {
                    watchdogFails++;
                    if (watchdogFails >= 2)
                    {
                        watchdogFails = 0;
                        ConnectVpn(); // Auto-reconnect
                    }
                }
                else
                {
                    watchdogFails = 0;
                }
            };
            watchdogTimer.Start();
        }

        // Real system throughput (physical adapters only, virtual tunnels excluded to avoid double counting)
        private void MeasureRealThroughput(out double dlMBps, out double ulMBps)
        {
            dlMBps = 0; ulMBps = 0;
            try
            {
                long rx = 0, tx = 0;
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                    string d = (ni.Description + " " + ni.Name).ToLowerInvariant();
                    if (d.Contains("wintun") || d.Contains("tun") || d.Contains("virtual") || d.Contains("vpn")) continue;
                    IPv4InterfaceStatistics st = ni.GetIPv4Statistics();
                    rx += st.BytesReceived; tx += st.BytesSent;
                }
                if (lastRx >= 0 && rx >= lastRx && tx >= lastTx)
                {
                    dlMBps = (rx - lastRx) / 1048576.0;
                    ulMBps = (tx - lastTx) / 1048576.0;
                }
                lastRx = rx; lastTx = tx;
            }
            catch { }
        }

        private void DrawSpeedGraph()
        {
            if (speedGraphCanvas == null) return;
            speedGraphCanvas.Children.Clear();

            double w = speedGraphCanvas.ActualWidth > 10 ? speedGraphCanvas.ActualWidth : 380;
            double h = speedGraphCanvas.ActualHeight > 10 ? speedGraphCanvas.ActualHeight : 46;

            Polyline line = new Polyline
            {
                Stroke = BrushFromHex("#00F2FE"),
                StrokeThickness = 2
            };

            Polygon fillPoly = new Polygon
            {
                Fill = new LinearGradientBrush(Color.FromArgb(90, 0, 242, 254), Color.FromArgb(0, 0, 242, 254), 90)
            };

            double max = Math.Max(speedHistory.Max(), 22.0);
            double step = w / (speedHistory.Count - 1);

            fillPoly.Points.Add(new Point(0, h));
            for (int i = 0; i < speedHistory.Count; i++)
            {
                double x = i * step;
                double y = h - (speedHistory[i] / max) * (h - 8) - 3;
                Point pt = new Point(x, y);
                line.Points.Add(pt);
                fillPoly.Points.Add(pt);
            }
            fillPoly.Points.Add(new Point(w, h));

            speedGraphCanvas.Children.Add(fillPoly);
            speedGraphCanvas.Children.Add(line);
        }

        // ================= PING & VLESS PARSER =================
        private async Task<int> TestTcpPingAsync(string host, int port, int timeoutMs = 2000)
        {
            return await Task.Run(() =>
            {
                try
                {
                    Stopwatch sw = Stopwatch.StartNew();
                    using (TcpClient client = new TcpClient())
                    {
                        IAsyncResult res = client.BeginConnect(host, port, null, null);
                        bool ok = res.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(timeoutMs));
                        if (!ok) return -1;
                        client.EndConnect(res);
                        sw.Stop();
                        return (int)sw.ElapsedMilliseconds;
                    }
                }
                catch { return -1; }
            });
        }

        private async Task PingAllServersAsync()
        {
            var tasks = servers.Select(async srv =>
            {
                int p = await TestTcpPingAsync(srv.Host, srv.Port);
                srv.Ping = p;
            });
            await Task.WhenAll(tasks);
            SaveData();
            RefreshAllUI();
        }

        private void AddVlessLinkFromModal()
        {
            string link = txtVlessLink.Text.Trim();
            ServerItem parsed = ParseVlessUrl(link);
            if (parsed == null)
            {
                MessageBox.Show("VLESS havolasi noto'g'ri formatda! 'vless://uuid@host:port?...' ko'rinishida bo'lishi kerak.", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            servers.Insert(0, parsed);
            settings.SelectedServerId = parsed.Id;
            SaveData();
            txtVlessLink.Text = "";
            modalOverlay.Visibility = Visibility.Collapsed;
            RefreshAllUI();
            PingNewServer(parsed);
        }

        private async void PingNewServer(ServerItem s)
        {
            s.Ping = await TestTcpPingAsync(s.Host, s.Port, 2500);
            SaveData();
            RefreshAllUI();
        }

        private ServerItem ParseVlessUrl(string link)
        {
            try
            {
                if (!link.StartsWith("vless://", StringComparison.OrdinalIgnoreCase)) return null;
                Uri uri = new Uri(link);
                string uuid = uri.UserInfo;
                string host = uri.Host;
                int port = uri.Port > 0 ? uri.Port : 443;
                string name = !string.IsNullOrEmpty(uri.Fragment) ? Uri.UnescapeDataString(uri.Fragment.TrimStart('#')) : (host + ":" + port);

                Dictionary<string, string> query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string qStr = uri.Query.TrimStart('?');
                foreach (string part in qStr.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    string[] kv = part.Split(new[] { '=' }, 2);
                    if (kv.Length == 2) query[kv[0]] = Uri.UnescapeDataString(kv[1]);
                }

                return new ServerItem
                {
                    Id = "srv_" + Guid.NewGuid().ToString("N").Substring(0, 8),
                    Name = name,
                    Country = DetectCountryCode(name),
                    Host = host,
                    Port = port,
                    Uuid = uuid,
                    Network = query.ContainsKey("type") ? query["type"] : "tcp",
                    Security = query.ContainsKey("security") ? query["security"] : "reality",
                    Sni = query.ContainsKey("sni") ? query["sni"] : host,
                    Fingerprint = query.ContainsKey("fp") ? query["fp"] : "chrome",
                    PublicKey = query.ContainsKey("pbk") ? query["pbk"] : "",
                    ShortId = query.ContainsKey("sid") ? query["sid"] : "",
                    Flow = query.ContainsKey("flow") ? query["flow"] : "",
                    Ping = 0,
                    Source = "manual"
                };
            }
            catch { return null; }
        }

        private void StartSyncSpin()
        {
            if (syncRotateTransform == null) return;
            Dispatcher.Invoke(() =>
            {
                DoubleAnimation da = new DoubleAnimation
                {
                    From = 0,
                    To = 360,
                    Duration = new Duration(TimeSpan.FromSeconds(0.85)),
                    RepeatBehavior = RepeatBehavior.Forever
                };
                syncRotateTransform.BeginAnimation(RotateTransform.AngleProperty, da);
            });
        }

        private void StopSyncSpin()
        {
            if (syncRotateTransform == null) return;
            Dispatcher.Invoke(() =>
            {
                syncRotateTransform.BeginAnimation(RotateTransform.AngleProperty, null);
                syncRotateTransform.Angle = 0;
            });
        }

        private async Task SyncSubscriptionAsync()
        {
            StartSyncSpin();
            try
            {
                if (string.IsNullOrEmpty(settings.SubUrl))
                {
                    await PingAllServersAsync();
                    return;
                }
                string userInfo = null;
                string url = settings.SubUrl;
                string raw = await Task.Run(() =>
                {
                    using (WebClient wc = new WebClient())
                    {
                        wc.Encoding = Encoding.UTF8;
                        wc.Headers.Add("User-Agent", "sing-box/ZedRay");
                        string d = wc.DownloadString(url);
                        userInfo = wc.ResponseHeaders != null ? wc.ResponseHeaders["subscription-userinfo"] : null;
                        return d;
                    }
                });

                if (!raw.Contains("://"))
                {
                    try { raw = Encoding.UTF8.GetString(Convert.FromBase64String(raw.Trim())); } catch { }
                }

                List<ServerItem> newServers = new List<ServerItem>();
                foreach (string line in raw.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    ServerItem s = ParseVlessUrl(line.Trim());
                    if (s != null) { s.Source = "subscription"; newServers.Add(s); }
                }

                // Real quota from the provider's "subscription-userinfo" header (if it sends one)
                settings.UsedGb = 0; settings.TotalGb = 0; settings.DaysLeft = 0;
                if (!string.IsNullOrEmpty(userInfo))
                {
                    long up = 0, down = 0, total = 0, exp = 0;
                    foreach (string part in userInfo.Split(';'))
                    {
                        string[] kv = part.Trim().Split('=');
                        if (kv.Length != 2) continue;
                        long v; long.TryParse(kv[1].Trim(), out v);
                        switch (kv[0].Trim().ToLowerInvariant())
                        {
                            case "upload": up = v; break;
                            case "download": down = v; break;
                            case "total": total = v; break;
                            case "expire": exp = v; break;
                        }
                    }
                    settings.UsedGb = (up + down) / 1073741824.0;
                    settings.TotalGb = total / 1073741824.0;
                    if (exp > 0)
                        settings.DaysLeft = Math.Max(0, (int)Math.Ceiling((DateTimeOffset.FromUnixTimeSeconds(exp) - DateTimeOffset.UtcNow).TotalDays));
                }

                if (newServers.Count == 0)
                {
                    MessageBox.Show("Obunadan birorta ham VLESS server topilmadi.", "ZedRay", MessageBoxButton.OK, MessageBoxImage.Warning);
                    SaveData(); RefreshAllUI();
                    return;
                }

                List<ServerItem> manual = servers.Where(x => x.Source != "subscription").ToList();
                servers = newServers.Concat(manual).ToList();
                SaveData();
                RefreshAllUI();
                await PingAllServersAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Obunani yangilashda xatolik: " + ex.Message, "ZedRay", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            finally
            {
                StopSyncSpin();
            }
        }

        // ================= PERSISTENCE (LOCAL ONLY, git-ignored) =================
        private static string Clean(string s) { return (s ?? "").Replace("|", " ").Replace("\r", "").Replace("\n", ""); }

        private void LoadData()
        {
            if (File.Exists(serversFile))
            {
                try
                {
                    foreach (string line in File.ReadAllLines(serversFile, Encoding.UTF8))
                    {
                        string[] p = line.Split('|');
                        if (p.Length >= 13)
                        {
                            servers.Add(new ServerItem
                            {
                                Id = p[0], Name = p[1], Country = p[2], Host = p[3],
                                Port = int.Parse(p[4]), Uuid = p[5], Network = p[6],
                                Security = p[7], Sni = p[8], Fingerprint = p[9],
                                PublicKey = p[10], ShortId = p[11], Flow = p[12],
                                Ping = p.Length > 13 ? int.Parse(p[13]) : 0,
                                Source = p.Length > 14 ? p[14] : "manual"
                            });
                        }
                    }
                }
                catch { }
            }

            if (File.Exists(settingsFile))
            {
                try
                {
                    string[] s = File.ReadAllText(settingsFile, Encoding.UTF8).Split('|');
                    if (s.Length >= 5)
                    {
                        settings.Mode = s[0];
                        settings.Mtu = int.Parse(s[1]);
                        settings.Watchdog = bool.Parse(s[2]);
                        settings.Routing = s[3];
                        settings.SelectedServerId = s[4];
                    }
                    if (s.Length >= 10)
                    {
                        settings.SubName = s[5];
                        settings.SubUrl = s[6];
                        settings.UsedGb = double.Parse(s[7], CultureInfo.InvariantCulture);
                        settings.TotalGb = double.Parse(s[8], CultureInfo.InvariantCulture);
                        settings.DaysLeft = int.Parse(s[9]);
                    }
                }
                catch { }
            }
        }

        private void SaveData()
        {
            try
            {
                List<string> lines = servers.Select(s => string.Join("|",
                    Clean(s.Id), Clean(s.Name), Clean(s.Country), Clean(s.Host), s.Port, Clean(s.Uuid), Clean(s.Network),
                    Clean(s.Security), Clean(s.Sni), Clean(s.Fingerprint), Clean(s.PublicKey), Clean(s.ShortId), Clean(s.Flow),
                    s.Ping, Clean(s.Source))).ToList();
                File.WriteAllLines(serversFile, lines, Encoding.UTF8);

                string cfg = string.Join("|", settings.Mode, settings.Mtu, settings.Watchdog, settings.Routing, settings.SelectedServerId,
                    Clean(settings.SubName), Clean(settings.SubUrl),
                    settings.UsedGb.ToString(CultureInfo.InvariantCulture), settings.TotalGb.ToString(CultureInfo.InvariantCulture), settings.DaysLeft);
                File.WriteAllText(settingsFile, cfg, Encoding.UTF8);
            }
            catch { }
        }

        private void SetupTrayIcon()
        {
            trayIcon = new System.Windows.Forms.NotifyIcon();
            trayIcon.Text = "ZedRay PRO VPN";
            string icoPath = System.IO.Path.Combine(appDir, "zedray.ico");
            if (File.Exists(icoPath))
                trayIcon.Icon = new System.Drawing.Icon(icoPath);
            else
                trayIcon.Icon = System.Drawing.SystemIcons.Shield;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += (s, e) => { this.Show(); this.WindowState = WindowState.Normal; this.Activate(); };
        }

        // ================= UI HELPERS =================
        private static Color ColorFromHex(string hex)
        {
            return (Color)ColorConverter.ConvertFromString(hex);
        }

        private static SolidColorBrush BrushFromHex(string hex)
        {
            return new SolidColorBrush(ColorFromHex(hex));
        }

        private static string DetectCountryCode(string name)
        {
            string l = (name ?? "").ToLowerInvariant();
            if (l.Contains("hong") || l.Contains("hk")) return "HK";
            if (l.Contains("germ") || l.Contains("de") || l.Contains("frank")) return "DE";
            if (l.Contains("us") || l.Contains("amer")) return "US";
            if (l.Contains("sing") || l.Contains("sg")) return "SG";
            if (l.Contains("jap") || l.Contains("jp")) return "JP";
            if (l.Contains("ru") || l.Contains("mosc")) return "RU";
            return "EU";
        }

        private static string EscapeJson(string s)
        {
            return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private Button CreateIconButton(string text, string bgHex, string fgHex)
        {
            Button b = new Button
            {
                Content = text,
                Width = 30, Height = 30,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Background = BrushFromHex(bgHex),
                Foreground = BrushFromHex(fgHex),
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand
            };
            b.Template = CreateRoundedButtonTemplate(8);
            return b;
        }

        private Button CreateActionPillButton(string text, string bgHex, string fgHex)
        {
            Button b = new Button
            {
                Content = text,
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Padding = new Thickness(10, 5, 10, 5),
                Background = BrushFromHex(bgHex),
                Foreground = BrushFromHex(fgHex),
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand
            };
            b.Template = CreateRoundedButtonTemplate(8);
            return b;
        }

        private ControlTemplate CreateRoundedButtonTemplate(double radius)
        {
            ControlTemplate ct = new ControlTemplate(typeof(Button));
            FrameworkElementFactory border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(radius));
            border.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Button.BackgroundProperty));
            border.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Button.PaddingProperty));

            FrameworkElementFactory cp = new FrameworkElementFactory(typeof(ContentPresenter));
            cp.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            cp.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(cp);

            ct.VisualTree = border;
            return ct;
        }
    }

    public class Program
    {
        [STAThread]
        public static void Main()
        {
            Application app = new Application();
            app.Run(new MainWindow());
        }
    }
}
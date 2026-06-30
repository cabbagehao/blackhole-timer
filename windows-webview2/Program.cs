using System;
using System.Windows.Forms;

namespace BlackHoleRest.WebView2;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new OverlayForm());
    }
}

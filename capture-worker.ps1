Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$nativeCode = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;

public class Win32Native {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, [Out] byte[] pvInfo, uint nLength, out uint lpnLengthNeeded);

    public const uint ES_CONTINUOUS = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED = 0x00000002;
    public const uint ES_AWAYMODE_REQUIRED = 0x00000040;

    public static uint EnableKeepAwake() {
        return SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED | ES_AWAYMODE_REQUIRED);
    }

    public static uint DisableKeepAwake() {
        return SetThreadExecutionState(ES_CONTINUOUS);
    }

    public static bool IsWorkstationLocked() {
        // DESKTOP_SWITCHDESKTOP = 0x0100
        IntPtr hDesk = OpenInputDesktop(0, false, 0x0100);
        if (hDesk == IntPtr.Zero) {
            int err = Marshal.GetLastWin32Error();
            // When Winlogon or secure desktop is active, returns ERROR_ACCESS_DENIED (5)
            if (err == 5 || err == 0) return true;
            return false;
        }

        uint needed = 0;
        GetUserObjectInformation(hDesk, 2 /* UOI_NAME */, null, 0, out needed);
        if (needed > 0) {
            byte[] buf = new byte[needed];
            if (GetUserObjectInformation(hDesk, 2, buf, needed, out needed)) {
                string name = System.Text.Encoding.Unicode.GetString(buf).TrimEnd('\0');
                CloseDesktop(hDesk);
                if (!string.Equals(name, "Default", StringComparison.OrdinalIgnoreCase)) {
                    return true;
                }
                return false;
            }
        }
        CloseDesktop(hDesk);
        return false;
    }
}

public class NoticeRenderer {
    public static void DrawLockedNotice(Bitmap bmp) {
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            int width = bmp.Width;
            int height = bmp.Height;

            using (SolidBrush bg = new SolidBrush(Color.FromArgb(15, 23, 42))) {
                g.FillRectangle(bg, 0, 0, width, height);
            }

            int cardW = Math.Min(680, (int)(width * 0.85));
            int cardH = Math.Min(340, (int)(height * 0.75));
            int cardX = (width - cardW) / 2;
            int cardY = (height - cardH) / 2;

            using (SolidBrush cardBg = new SolidBrush(Color.FromArgb(30, 41, 59)))
            using (Pen cardBorder = new Pen(Color.FromArgb(59, 130, 246), 2)) {
                g.FillRectangle(cardBg, cardX, cardY, cardW, cardH);
                g.DrawRectangle(cardBorder, cardX, cardY, cardW, cardH);
            }

            using (StringFormat sf = new StringFormat()) {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;

                using (Font titleFont = new Font("Segoe UI", 18, FontStyle.Bold))
                using (SolidBrush titleBrush = new SolidBrush(Color.FromArgb(248, 250, 252))) {
                    g.DrawString("[ Remote Host Locked - Winlogon ]", titleFont, titleBrush,
                        new RectangleF(cardX, cardY + 25, cardW, 40), sf);
                }

                using (Font subFont = new Font("Segoe UI", 11, FontStyle.Regular))
                using (SolidBrush subBrush = new SolidBrush(Color.FromArgb(148, 163, 184))) {
                    g.DrawString("Windows has switched to the secure login desktop (Winlogon).\nStandard user-mode applications cannot view or enter passwords on this screen.",
                        subFont, subBrush, new RectangleF(cardX + 20, cardY + 75, cardW - 40, 60), sf);
                }

                using (Font hintFont = new Font("Segoe UI", 12, FontStyle.Bold))
                using (SolidBrush hintBrush = new SolidBrush(Color.FromArgb(96, 165, 250))) {
                    g.DrawString("Please unlock at the physical monitor.\nLive desktop view will resume automatically.",
                        hintFont, hintBrush, new RectangleF(cardX + 20, cardY + 145, cardW - 40, 60), sf);
                }

                using (Font tipFont = new Font("Segoe UI", 9, FontStyle.Italic))
                using (SolidBrush tipBrush = new SolidBrush(Color.FromArgb(100, 116, 139))) {
                    g.DrawString("Tip: Keep-Awake / Anti-Lock is active in NodeDesk to prevent automatic sleep & idle autolock.",
                        tipFont, tipBrush, new RectangleF(cardX + 20, cardY + 225, cardW - 40, 50), sf);
                }
            }
        }
    }
}
'@

Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition $nativeCode

# Enable Keep-Awake while capture worker is running
[Win32Native]::EnableKeepAwake() | Out-Null

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$width = $bounds.Width
$height = $bounds.Height

$stdout = [System.Console]::OpenStandardOutput()
$stdin = [System.Console]::OpenStandardInput()
$reader = New-Object System.IO.StreamReader($stdin)

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]50)

while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line -or $line -eq "quit") { break }

    $isLocked = [Win32Native]::IsWorkstationLocked()
    $bmp = New-Object System.Drawing.Bitmap($width, $height)

    if ($isLocked) {
        [NoticeRenderer]::DrawLockedNotice($bmp)
    } else {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        } catch {
            # In case the desktop switched right during capture
            $isLocked = $true
            [NoticeRenderer]::DrawLockedNotice($bmp)
        } finally {
            $g.Dispose()
        }
    }

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $jpegCodec, $encoderParams)
    $bmp.Dispose()

    $bytes = $ms.ToArray()
    $ms.Dispose()

    $statusTag = if ($isLocked) { ":LOCKED`n" } else { ":OK`n" }
    $header = [System.Text.Encoding]::ASCII.GetBytes("FRAME:" + $bytes.Length.ToString() + $statusTag)
    $stdout.Write($header, 0, $header.Length)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

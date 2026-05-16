Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$width = $bounds.Width
$height = $bounds.Height

$stdout = [System.Console]::OpenStandardOutput()
$stdin = [System.Console]::OpenStandardInput()
$reader = New-Object System.IO.StreamReader($stdin)

while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line -or $line -eq "quit") { break }

    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]50)
    $bmp.Save($ms, $jpegCodec, $encoderParams)
    $bmp.Dispose()

    $bytes = $ms.ToArray()
    $ms.Dispose()

    $header = [System.Text.Encoding]::ASCII.GetBytes("FRAME:" + $bytes.Length.ToString() + "`n")
    $stdout.Write($header, 0, $header.Length)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

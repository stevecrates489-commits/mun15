param([string]$In, [string]$Out, [int]$Max = 900)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($In)
$scale = [Math]::Min(1.0, $Max / [Math]::Max($src.Width, $src.Height))
$w = [int]($src.Width * $scale); $h = [int]($src.Height * $scale)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $w, $h)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 82
$bmp.Save($Out, $codec, $params)
$g.Dispose(); $bmp.Dispose(); $src.Dispose()
"JPEG $Out ${w}x${h}"

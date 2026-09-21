# 从 public/assets/icon-source.jpg 重新生成 favicon.ico 与 PNG 图标。
# 小尺寸（16/32/48/64）用传统 32bpp DIB，大尺寸（128/256）用 PNG 内嵌：
# 这样浏览器、Windows 资源管理器，以及只认传统 ICO 的老程序都能正确解码。
# 用法：powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'public\assets\icon-source.jpg'
$icoPath = Join-Path $projectRoot 'public\favicon.ico'
$png192 = Join-Path $projectRoot 'public\assets\icon-192.png'
$png512 = Join-Path $projectRoot 'public\assets\icon-512.png'

if (-not (Test-Path -LiteralPath $source)) {
  Write-Host "找不到源图：$source" -ForegroundColor Red
  exit 1
}

$src = [System.Drawing.Image]::FromFile($source)
# 取中间 84% 的方形区域：保留两盏灯与背影，裁掉最外侧屋檐，缩到 16px 也能看出是"雾中的会馆"
$side = [int]([Math]::Min($src.Width, $src.Height) * 0.84)
$cx = [int](($src.Width - $side) / 2)
$cy = [int](($src.Height - $side) / 2)

function New-Square {
  param([System.Drawing.Image]$Image, [int]$X, [int]$Y, [int]$Side, [int]$Size)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $dest = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $from = New-Object System.Drawing.Rectangle($X, $Y, $Side, $Side)
  $g.DrawImage($Image, $dest, $from, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $bmp
}

function ConvertTo-PngBytes {
  param([System.Drawing.Bitmap]$Bmp)
  $ms = New-Object System.IO.MemoryStream
  $Bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray(); $ms.Dispose()
  return , $bytes
}

# 32bpp DIB：BITMAPINFOHEADER（高度写两倍）+ 自下而上的 BGRA 像素 + 全零 AND 掩码
function ConvertTo-DibBytes {
  param([System.Drawing.Bitmap]$Bmp)
  $size = $Bmp.Width
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $data = $Bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $pixels = New-Object byte[] ($stride * $size)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $pixels.Length)
  $Bmp.UnlockBits($data)

  $maskRow = [int]([Math]::Floor(($size + 31) / 32) * 4)
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt32]40)
  $bw.Write([Int32]$size)
  $bw.Write([Int32]($size * 2))
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]0)
  $bw.Write([UInt32]0)
  $bw.Write([Int32]0); $bw.Write([Int32]0)
  $bw.Write([UInt32]0); $bw.Write([UInt32]0)
  for ($y = $size - 1; $y -ge 0; $y--) { $bw.Write($pixels, $y * $stride, $size * 4) }
  $bw.Write((New-Object byte[] ($maskRow * $size)))
  $bw.Flush()
  $bytes = $ms.ToArray(); $bw.Close(); $ms.Close()
  return , $bytes
}

$plan = @(
  @{ Size = 16;  Kind = 'dib' },
  @{ Size = 32;  Kind = 'dib' },
  @{ Size = 48;  Kind = 'dib' },
  @{ Size = 64;  Kind = 'dib' },
  @{ Size = 128; Kind = 'png' },
  @{ Size = 256; Kind = 'png' }
)

$entries = @()
foreach ($item in $plan) {
  $bmp = New-Square -Image $src -X $cx -Y $cy -Side $side -Size $item.Size
  if ($item.Kind -eq 'dib') { $bytes = [byte[]](ConvertTo-DibBytes -Bmp $bmp) } else { $bytes = [byte[]](ConvertTo-PngBytes -Bmp $bmp) }
  $entries += [pscustomobject]@{ Size = $item.Size; Kind = $item.Kind; Bytes = $bytes }
  $bmp.Dispose()
}

$stream = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($entry in $entries) {
  $dim = 0
  if ($entry.Size -lt 256) { $dim = $entry.Size }
  $writer.Write([byte]$dim); $writer.Write([byte]$dim)
  $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([UInt16]1); $writer.Write([UInt16]32)
  $writer.Write([UInt32]$entry.Bytes.Length); $writer.Write([UInt32]$offset)
  $offset += $entry.Bytes.Length
}
foreach ($entry in $entries) { $writer.Write($entry.Bytes) }
$writer.Flush(); $writer.Close(); $stream.Close()

[System.IO.File]::WriteAllBytes($png192, [byte[]](ConvertTo-PngBytes -Bmp (New-Square -Image $src -X $cx -Y $cy -Side $side -Size 192)))
[System.IO.File]::WriteAllBytes($png512, [byte[]](ConvertTo-PngBytes -Bmp (New-Square -Image $src -X $cx -Y $cy -Side $side -Size 512)))
$src.Dispose()

Write-Host ("源图裁切 {0}x{1} @ ({2},{3})" -f $side, $side, $cx, $cy) -ForegroundColor Green
foreach ($entry in $entries) { Write-Host ("  {0,3}px {1} {2,8} bytes" -f $entry.Size, $entry.Kind.ToUpper(), $entry.Bytes.Length) }
Write-Host ("已写入 favicon.ico / icon-192.png / icon-512.png") -ForegroundColor Green

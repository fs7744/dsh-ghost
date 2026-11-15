export {} from './types.js';
/** PowerShell 单引号字符串转义（单引号要写两个）。 */
export function escapePowerShellString(text) {
    return text.replace(/'/g, "''");
}
/** 全屏截图脚本。 */
export function screenshotScript(outputPath) {
    return `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${escapePowerShellString(outputPath)}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()
Write-Output 'ok'`;
}
/** 鼠标点击脚本。 */
export function clickScript(x, y, button = 'left') {
    const down = button === 'right' ? '0x0008' : '0x0002';
    const up = button === 'right' ? '0x0010' : '0x0004';
    const twice = button === 'double' ? `
[MouseOps]::mouse_event(${down},0,0,0,[UIntPtr]::Zero)
[MouseOps]::mouse_event(${up},0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 60` : '';
    return `$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseOps {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[MouseOps]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 60
[MouseOps]::mouse_event(${down},0,0,0,[UIntPtr]::Zero)
[MouseOps]::mouse_event(${up},0,0,0,[UIntPtr]::Zero)${twice}
Write-Output 'ok'`;
}
/** 文本输入脚本（Unicode 逐字符 SendInput，中文也能打）。 */
export function typeScript(text) {
    return `$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class KeyboardOps {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
}
'@
$chars = [char[]]'${escapePowerShellString(text)}'
foreach ($ch in $chars) {
  $inputs = New-Object KeyboardOps+INPUT[] 2
  $inputs[0].type = 1
  $inputs[0].u.ki.wScan = [ushort][int][char]$ch
  $inputs[0].u.ki.dwFlags = 0x0004
  $inputs[1].type = 1
  $inputs[1].u.ki.wScan = [ushort][int][char]$ch
  $inputs[1].u.ki.dwFlags = 0x0004 + 0x0002
  [KeyboardOps]::SendInput(2, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf([type][KeyboardOps+INPUT])) | Out-Null
  Start-Sleep -Milliseconds 8
}
Write-Output 'ok'`;
}
/** 特殊按键脚本（ENTER / TAB / CTRL+A 等，走 SendKeys）。 */
export function keysScript(keys) {
    return `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(keys)}')
Write-Output 'ok'`;
}
/** UI Automation 元素树脚本（控件名、类型、位置、可用性）。 */
export function elementsScript(limit = 200) {
    return `$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$list = New-Object System.Collections.ArrayList
$count = 0
foreach ($el in $all) {
  if ($count -ge ${limit}) { break }
  try {
    $current = $el.Current
    $rect = $current.BoundingRectangle
    if ([string]::IsNullOrEmpty($current.Name) -and [string]::IsNullOrEmpty($current.AutomationId)) { continue }
    [void]$list.Add([pscustomobject]@{
      name = $current.Name
      type = $current.ControlType.ProgrammaticName
      automationId = $current.AutomationId
      x = [int]$rect.X
      y = [int]$rect.Y
      w = [int]$rect.Width
      h = [int]$rect.Height
      enabled = $current.IsEnabled
    })
    $count++
  } catch { }
}
$list | ConvertTo-Json -Compress -Depth 3`;
}
/** 解析元素树输出（PowerShell 可能返回对象或数组）。 */
export function parseElements(output) {
    const text = output.trim();
    if (text === '')
        return [];
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return [];
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const out = [];
    for (const item of list) {
        if (typeof item !== 'object' || item === null)
            continue;
        const value = item;
        const name = typeof value.name === 'string' ? value.name : '';
        const type = typeof value.type === 'string' ? value.type : '';
        const automationId = typeof value.automationId === 'string' ? value.automationId : '';
        if (name === '' && automationId === '')
            continue;
        out.push({
            name,
            type: type.replace('ControlType.', ''),
            automationId,
            x: typeof value.x === 'number' ? value.x : 0,
            y: typeof value.y === 'number' ? value.y : 0,
            width: typeof value.w === 'number' ? value.w : 0,
            height: typeof value.h === 'number' ? value.h : 0,
            enabled: value.enabled !== false,
        });
    }
    return out;
}
/** Windows 平台判定（电脑操控只在 Windows 上做）。 */
export function isWindows(platform) {
    return platform === 'win32';
}
/**
 * 按控件名直接操作（**不需要截图、不需要坐标**）——这是业界成熟的路径：
 * Windows UI Automation 提供 InvokePattern（点按钮）、ValuePattern（填输入框）、
 * TogglePattern（勾选）等**语义化动作**，比「截图找按钮 + 点坐标」稳得多。
 *
 * 策略：先找同名控件（可带类型过滤）→ 优先 InvokePattern → 再退回
 * LegacyIAccessible.DoDefaultAction → 最后才 SetFocus + 回车（最保守）。
 */
export function invokeScript(name, controlType = '') {
    return `$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($el in $all) {
  try {
    if ($el.Current.Name -ne '${escapePowerShellString(name)}') { continue }
    ${controlType === '' ? '' : `if ($el.Current.ControlType.ProgrammaticName -notlike '*${escapePowerShellString(controlType)}*') { continue }`}
    $target = $el
    break
  } catch { }
}
if ($null -eq $target) { Write-Output 'not-found'; exit 0 }
try {
  $pattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
  Write-Output 'invoked'
  exit 0
} catch { }
try {
  $legacy = $target.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
  $legacy.DoDefaultAction()
  Write-Output 'invoked-legacy'
  exit 0
} catch { }
try {
  $target.SetFocus()
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Write-Output 'focused-entered'
  exit 0
} catch { }
Write-Output 'no-action'`;
}
/**
 * 按控件名填值（ValuePattern；没有就退回聚焦 + 全选 + 粘贴）。
 */
export function setValueScript(name, text) {
    return `$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($el in $all) {
  try {
    if ($el.Current.Name -ne '${escapePowerShellString(name)}') { continue }
    $target = $el
    break
  } catch { }
}
if ($null -eq $target) { Write-Output 'not-found'; exit 0 }
try {
  $pattern = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $pattern.SetValue('${escapePowerShellString(text)}')
  Write-Output 'set'
  exit 0
} catch { }
try {
  $target.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(text)}')
  Write-Output 'focused-typed'
  exit 0
} catch { }
Write-Output 'no-action'`;
}

# Load Powershell Prompt enhancers
~/WinTerminal/enable-powershell-prompt.ps1

# Env Vars
$env:DEV_PATH = 'C:\Development\CCEPnPTools'
$env:UTILS_PATH = Join-Path $env:DEV_PATH '\Utils'
$env:SDL_TOOLS_PATH = Join-Path $env:UTILS_PATH 'sdl-utils-now-board\utils\Shared'


$env:http_proxy = $env:HTTP_PROXY
#http://proxy-dmz.intel.com:912
$env:https_proxy = $env:HTTPS_PROXY
#http://proxy-dmz.intel.com:912
$env:no_proxy = $env:NO_PROXY
#'127.0.0.1,localhost,.intel.com,intel.com,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.services.ai.azure.com,.azure.com'

. (Join-Path $env:SDL_TOOLS_PATH '.powershell_aliases.ps1')

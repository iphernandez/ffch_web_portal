

# Load Angular CLI autocompletion.
source <(ng completion script)

# Load Bash Prompt enhancers
eval "$(/c/Users/iphernan/WinTerminal/enable-bash-prompt.sh)"

# Env vars
export DEV_PATH=/c/Development/CCEPnPTools
export UTILS_PATH=$DEV_PATH/Utils
export SDL_TOOLS_PATH=$UTILS_PATH/sdl-utils-now-board/utils/Shared
export GIT_MERGE_AUTOEDIT=no
export GOPRIVATE=github.com/intel-innersource

export WOLF_REG_USR=sys_bldt_artifactory
export WOLF_REG_PWD=PD1q0neRzItK47ATHu867g==

export http_proxy=$HTTP_PROXY
#http://proxy-dmz.intel.com:912
export https_proxy=$HTTPS_PROXY
#http://proxy-dmz.intel.com:912
export no_proxy=$NO_PROXY
#127.0.0.1,localhost,.intel.com,intel.com,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.services.ai.azure.com,.azure.com

# Aliases
alias ffch_convocatoria='cd $DEV_PATH/../GitHub/ffch_web_portal/webJsApp/ && npm run auto:convocatoria'
alias ffch_lista='cd $DEV_PATH/../GitHub/ffch_web_portal/webJsApp/ && npm run auto:poll-votes'
alias ffch_convocados='cd $DEV_PATH/../GitHub/ffch_web_portal/webJsApp/ && npm run auto:convocados'
. $SDL_TOOLS_PATH/.bash_aliases
alias list_local='cat ~/.bashrc'

# GitHub Copilot CLI wrapper
# Works around a bug in the nvm-generated "copilot" shim (in .nodejs/) that
# mis-handles the space in the "Author Software" install path. This resolves
# the currently active nvm version each call, so it keeps working after
# `nvm use`/`nvm install`.
copilot() {
  local ver
  ver="$(nvm list 2>/dev/null | grep '\*' | awk '{print $2}')"
  local base="/c/Users/iphernan/AppData/Local/Author Software/nvm/installs/v${ver}"
  "${base}/node.exe" "${base}/node_modules/@github/copilot/npm-loader.js" "$@"
}

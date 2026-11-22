################################################################################
##### TO ENABLE BASH enhancers
# Run the following commands in Powershell:
# winget install JanDeDobbeleer.OhMyPosh --source winget
# New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\WinTerminal" -Target "C:\Users\iphernan\OneDrive - Intel Corporation\Utilities\WinTerminal"
# Download "CascadiaMono" and "CascadiaCode" from https://www.nerdfonts.com/ (.ZIP files)
# Extract all files from the ZIP files
# Select all font files, right-click and select "Install"
# Restart WinTerminal
# Add the 2 commented lines to the ~./.bashrc and uncomment the "eval" line:
# Load Bash Prompt enhancers
# eval "$(/c/Users/iphernan/WinTerminal/enable-bash-prompt.sh)"

oh-my-posh init bash --config "/c/Users/iphernan/WinTerminal/oh-my-posh-themes/iphtheme2.omp.json"
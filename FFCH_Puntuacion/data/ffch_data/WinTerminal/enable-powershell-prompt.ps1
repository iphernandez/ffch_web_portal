################################################################################
##### TO ENABLE POWERSHELL ENHANCERS
# Run the following commands in Powershell:
# winget install JanDeDobbeleer.OhMyPosh --source winget
# New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\WinTerminal" -Target "C:\Users\iphernan\OneDrive - Intel Corporation\Utilities\WinTerminal"
# notepad $PROFILE
# Download "CascadiaMono" and "CascadiaCode" from https://www.nerdfonts.com/ (.ZIP files)
# Extract all files from the ZIP files
# Select all font files, right-click and select "Install"
# Restart WinTerminal
# Add the 2 commented lines to the $PROFILE and uncomment the second line:
# Load Powershell Prompt enhancers
# ~/WinTerminal/enable-powershell-prompt.ps1

oh-my-posh init pwsh --eval --config '~/WinTerminal/oh-my-posh-themes/iphtheme2.omp.json' | Invoke-Expression

Import-Module -Name Terminal-Icons

# Other Themes:
#	~/WinTerminal/oh-my-posh-themes/iphtheme1.omp.json
#	amro
#	1_shell
#	di4am0nd
#	material
#	negligible*
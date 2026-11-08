# Publie les modifications de ce dossier sur GitHub (depot cfetest/agenda-cfecgc).
# Le site est ensuite redeploye automatiquement par GitHub Actions.
# Usage : .\publier.ps1 ["message"]   ou double-clic sur publier.cmd
param([string]$Message = "Mise a jour de l'agenda")

Set-Location $PSScriptRoot
$repo = 'https://github.com/cfetest/agenda-cfecgc.git'

$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) {
    $p = 'C:\Program Files\Git\cmd\git.exe'
    if (Test-Path $p) { $git = $p }
    else { Write-Host "Git n'est pas installe. Lance : winget install --id Git.Git -e"; exit 1 }
}

function G { & $git @args; if ($LASTEXITCODE -ne 0) { Write-Host "ERREUR : git $args"; exit 1 } }

# Premiere fois : relie le dossier au depot existant sans toucher aux fichiers locaux.
if (-not (Test-Path .git)) {
    G init -q
    G remote add origin $repo
    G config user.name 'cfetest'
    G config user.email 'cfetest@users.noreply.github.com'
    G fetch -q origin main
    G checkout -q -B main
    G reset -q origin/main
    G branch -q -u origin/main
}

# Branche courante : "main" = site en ligne ; une autre (ex. "redesign") = essai envoye sur GitHub,
# sans toucher au site (la tache GitHub ne se declenche que sur main).
$branch = (& $git rev-parse --abbrev-ref HEAD).Trim()

G add -A
if (& $git status --porcelain) {
    & $git status --short
    G commit -q -m $Message
}
$remote = & $git ls-remote --heads origin $branch
if ($remote) {
    G pull -q --rebase origin $branch
    if (-not (& $git log --oneline "origin/$branch..$branch")) {
        Write-Host "Rien a publier : la branche $branch est deja a jour sur GitHub."
        exit 0
    }
}
G push -q -u origin $branch
if ($branch -eq 'main') {
    Write-Host 'Publie. Le site sera a jour dans 2 a 3 minutes : https://cfetest.github.io/agenda-cfecgc/'
} else {
    Write-Host "Branche $branch envoyee sur GitHub. Le site en ligne n'a PAS change (il suit la branche main)."
}

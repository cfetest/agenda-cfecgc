# Recupere les rendez-vous a venir de l'agenda de cfecgc-orange.org
# et genere index.html : les donnees (window.EVENTS) + le cadre de la page ; l'interface
# (onglets, frise, calendrier, carte, filtres, recherche) est dans app.js, le style dans style.css.
# Lance 3 fois par jour (8h, 14h, 18h heure de Paris) par GitHub Actions.
# -Ajouts : fichier JSON de rendez-vous ajoutes a la main ou depuis des mails
# (memes cles que window.EVENTS : t, d, h, g, x, u). Ignore s'il n'existe pas.
param([string]$Ajouts = (Join-Path $PSScriptRoot 'ajouts.json'))

$ErrorActionPreference = 'Stop'
$source  = 'https://www.cfecgc-orange.org/evenements/'
$outFile = Join-Path $PSScriptRoot 'index.html'
$logFile = Join-Path $PSScriptRoot 'fetch.log'
$fr      = [Globalization.CultureInfo]::GetCultureInfo('fr-FR')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Log($msg) {
  Add-Content -Path $logFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8
}
function Clean($html) {
  $t = [regex]::Replace($html, '<[^>]+>', ' ')
  $t = [Net.WebUtility]::HtmlDecode($t)
  return ([regex]::Replace($t, '\s+', ' ')).Trim()
}
function Enc($s) { [Net.WebUtility]::HtmlEncode($s) }
# Heure de Paris, meme sur une machine reglee en UTC (GitHub Actions)
function ParisNow { [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date).ToUniversalTime(), 'Romance Standard Time') }

$wc = New-Object Net.WebClient
$wc.Encoding = [Text.Encoding]::UTF8

# ---------- Evenements a venir (page /evenements/, plusieurs pages) ----------
$events = New-Object System.Collections.ArrayList
$seenEv = @{}
$today  = (ParisNow).Date
try {
  for ($p = 1; $p -le 5; $p++) {
    $url = if ($p -eq 1) { $source } else { "${source}page/$p/" }
    # WebClient efface ses en-tetes apres chaque requete, et le site renvoie 403 sans User-Agent
    $wc.Headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AgendaBot'
    try { $eh = $wc.DownloadString($url) } catch {
      if ($p -eq 1) { Log "ERREUR telechargement ($url) : $($_.Exception.Message) (page precedente conservee)"; exit 1 }
      Log "AVERTISSEMENT ($url) : $($_.Exception.Message)"; break
    }
    $foundFuture = $false
    foreach ($m in [regex]::Matches($eh, '(?s)<article\b.*?</article>')) {
      $b = $m.Value
      $a = [regex]::Match($b, '(?s)<h[23][^>]*>\s*<a\s+href="([^"]+)"[^>]*>(.*?)</a>')
      $d = [regex]::Match($b, '<span class="date">(.*?)</span>')
      if (-not $a.Success -or -not $d.Success) { continue }
      $dateTxt = Clean $d.Groups[1].Value
      $date = [DateTime]::MinValue
      if (-not [DateTime]::TryParseExact($dateTxt, 'd MMMM yyyy', $fr, 'None', [ref]$date)) { continue }
      if ($date -lt $today) { continue }
      $foundFuture = $true
      $link = $a.Groups[1].Value
      if ($seenEv.ContainsKey($link)) { continue }
      $seenEv[$link] = $true
      $tm  = [regex]::Match($b, '<span class="time">(.*?)</span>')
      $tag = [regex]::Match($b, '<span class="tag">(.*?)</span>')
      [void]$events.Add([pscustomobject]@{
        Title = Clean $a.Groups[2].Value; Url = $link; Date = $date
        Time  = $(if ($tm.Success) { Clean $tm.Groups[1].Value } else { '' })
        Tag   = $(if ($tag.Success) { Clean $tag.Groups[1].Value } else { '' })
        Extract = $(if ($x = [regex]::Match($b, '(?s)<p class="extract">(.*?)</p>')) { if ($x.Success) { (Clean $x.Groups[1].Value) -replace '\s*\[\S*\]\s*$', '...' } else { '' } })
      })
    }
    if (-not $foundFuture) { break }
  }
} catch { Log "ERREUR evenements : $($_.Exception.Message) (page precedente conservee)"; exit 1 }
$events = @($events | Sort-Object Date, Time)
if ($events.Count -eq 0) {
  Log "ERREUR : aucun rendez-vous a venir trouve (la mise en page du site a peut-etre change). Page precedente conservee."
  exit 2
}

# ---------- Rendez-vous ajoutes (hors site, ex. recus par mail) ----------
$added = 0
if (Test-Path $Ajouts) {
  try {
    # PS 5.1 : ConvertFrom-Json renvoie le tableau en un seul objet ; le passer par une variable l'enumere
    $list = Get-Content $Ajouts -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($a in $list) {
      $date = [DateTime]::MinValue
      if (-not [DateTime]::TryParseExact([string]$a.d, 'yyyy-MM-dd', $fr, 'None', [ref]$date) -or -not $a.t) { continue }
      if ($date -lt $today) { continue }
      if ($events | Where-Object { $_.Date -eq $date -and $_.Title -eq $a.t }) { continue }
      # Communications email : AUCUN lien publie (ni suivi, ni desabonnement, ni mailto). La carte
      # affiche a la place "voir mail" + un lien vers la page d'abonnement de la CFE-CGC Orange.
      if ([string]$a.u) { Log "INFO ajouts : lien ignore pour '$($a.t)' (aucun lien publie pour les communications email)" }
      $events += [pscustomobject]@{ Title = [string]$a.t; Url = ''; Date = $date; Time = [string]$a.h
                                    Tag = [string]$a.g; Extract = [string]$a.x; Added = $true }
      $added++
    }
    $events = @($events | Sort-Object Date, Time)
  } catch { Log "AVERTISSEMENT ajouts ($Ajouts) : $($_.Exception.Message) (ajouts ignores)" }
}

# ---------- Lieux (carte) ----------
# Le site ne donne pas de champ "lieu" : on le deduit du titre / libelle / description, dans cet ordre :
# site Orange connu (lieux-orange.csv) > adresse postale > [Ville] > "Ville : ..." > departement
# (chef-lieu, departements.csv). Sinon : Teams, a distance, ou lieu inconnu (pave "ordinateur").
# Geocodage : api-adresse.data.gouv.fr (service public gratuit), un appel par lieu distinct.
function Norm($s) {
  $d = ([string]$s).Normalize([Text.NormalizationForm]::FormD)
  $d = [regex]::Replace($d, '\p{Mn}', '')
  return ([regex]::Replace($d.ToLowerInvariant(), "[^a-z0-9]+", ' ')).Trim()
}
function ReadCsv($name) {
  $p = Join-Path $PSScriptRoot $name
  if (Test-Path $p) { return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) | ConvertFrom-Csv -Delimiter ';' }
  return @()
}
# Sites connus (lieux-orange.csv) : coordonnees deja calculees (pas d'appel reseau), plusieurs
# variantes de nom par site. Comparaison sur texte normalise (NormLoc) : sans accents ni majuscules,
# tirets / apostrophes / ponctuation = espace, oe/ae, pluriel (s ou x final ignore), St = Saint,
# 1er = Ier, mots entiers seulement. Variantes "fortes" : suffisent seules. Variantes "de contexte"
# (noms courants : Patio, Village, Voltaire...) : seulement si le titre commence par elles
# ("Le Patio : Accueil cafe"), si la ville du site figure dans le texte, ou apres site/campus/
# batiment/immeuble/tour. Les variantes les plus longues sont testees en premier.
function NormLoc($s) {
  $t = ([string]$s).Replace([string][char]0x153, 'oe').Replace([string][char]0x152, 'OE').Replace([string][char]0xE6, 'ae')
  $w = foreach ($x in ((Norm $t) -split ' ')) {
    if ($x -eq 'st') { 'saint' } elseif ($x -eq 'ste') { 'sainte' } elseif ($x -eq '1er') { 'ier' }
    elseif ($x.Length -gt 3 -and $x -match '[sx]$') { $x.Substring(0, $x.Length - 1) } else { $x }
  }
  return ' ' + (@($w) -join ' ') + ' '
}
$siteKeys = New-Object System.Collections.ArrayList
foreach ($s in @(ReadCsv 'lieux-orange.csv')) {
  if (-not $s.lat) { continue }
  $s | Add-Member -NotePropertyName VilleKey -NotePropertyValue (NormLoc $s.ville) -Force
  foreach ($pair in @(@($s.variantes, $false), @($s.variantes_contexte, $true))) {
    foreach ($v in ([string]$pair[0] -split '\|')) {
      $k = (NormLoc $v).Trim()
      if ($k) { [void]$siteKeys.Add([pscustomobject]@{ K = " $k "; Weak = $pair[1]; S = $s }) }
    }
  }
}
$siteKeys = @($siteKeys | Sort-Object { $_.K.Length } -Descending)
function SiteOf($e) {
  $txt = NormLoc "$($e.Title) | $($e.Tag) | $($e.Extract)"
  $m = [regex]::Match([string]$e.Title, '^\s*([^:]{2,60}?)\s*:')
  $pre = if ($m.Success) { NormLoc $m.Groups[1].Value } else { '' }
  foreach ($x in $siteKeys) {
    if (-not $txt.Contains($x.K)) { continue }
    if (-not $x.Weak -or $pre -eq $x.K -or $txt.Contains($x.S.VilleKey) -or
        $txt -match (' (site|campus|batiment|immeuble|tour)( d| de| du| de la| des)?' + [regex]::Escape($x.K))) { return $x.S }
  }
  return $null
}
$depts = @{}
foreach ($r in (ReadCsv 'departements.csv')) { $depts[(Norm $r.departement)] = $r.'chef-lieu' }
$geoCache = @{}
function Geo {
  param([Parameter(Position = 0)][string]$q, [switch]$City)
  $k = "$City|$q"
  if ($geoCache.ContainsKey($k)) { return $geoCache[$k] }
  $res = $null
  try {
    $url = 'https://api-adresse.data.gouv.fr/search/?limit=1&q=' + [uri]::EscapeDataString($q) + $(if ($City) { '&type=municipality' } else { '' })
    $wc.Headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AgendaBot'
    $f = @(($wc.DownloadString($url) | ConvertFrom-Json).features)[0]
    if ($f) {
      $town = [string]$f.properties.city
      # Ville : le nom trouve doit figurer dans la recherche (evite "Rendez-vous de l'epargne" -> une commune au hasard)
      # ... ou la commune commence par la recherche ("Eragny" -> "Eragny-sur-Oise")
      $nq = Norm $q; $nt = Norm $town
      $ok = if ($City) { (' ' + $nq + ' ').Contains(' ' + $nt + ' ') -or ($nq.Length -ge 4 -and $nt.StartsWith("$nq ")) } else { $f.properties.score -ge 0.5 }
      # Dep : numero du departement (debut de "context", ex. "45, Loiret, Centre-Val de Loire")
      $dep = ([string]$f.properties.context -split ',')[0].Trim()
      if ($ok) { $res = [pscustomobject]@{ Lat = [math]::Round($f.geometry.coordinates[1], 5); Lon = [math]::Round($f.geometry.coordinates[0], 5); City = $town; Dep = $dep } }
    }
  } catch { Log "AVERTISSEMENT geocodage ($q) : $($_.Exception.Message)" }
  $geoCache[$k] = $res
  return $res
}
# Adresse postale ("63 rue du Rocher, 75008 Paris")
$reAddr = '\d{1,4}\s*(bis|ter)?,?\s+(rue|avenue|av\.|boulevard|bd|place|all\u00e9e|quai|chemin|route|cours|impasse)\s[^,;|]{2,60}?,?\s\d{5}\s+[^\s,.;|]+(-[^\s,.;|]+)*'
# Ville trouvee par son nom : on ajoute le numero de departement, ex. "Orleans (45)"
function WithDep($name, $g) { if ($g.Dep) { "$name ($($g.Dep))" } else { $name } }
# Zone du filtre "Lieu" (cle r), d'apres le departement : regions administratives, l'Occitanie
# partagee entre ex-Languedoc-Roussillon (sud-est) et ex-Midi-Pyrenees (sud-ouest), les
# Hauts-de-France au nord-est, la Corse a part ; tout autre departement (outre-mer) = hm
# "Hors Metropole". Libelles des zones dans app.js (ZONES).
$zoneOf = @{}
@{ idf = '75 77 78 91 92 93 94 95'
   no  = '14 18 22 27 28 29 35 36 37 41 44 45 49 50 53 56 61 72 76 85'
   ne  = '02 08 10 21 25 39 51 52 54 55 57 58 59 60 62 67 68 70 71 80 88 89 90'
   se  = '01 03 04 05 06 07 11 13 15 26 30 34 38 42 43 48 63 66 69 73 74 83 84'
   so  = '09 12 16 17 19 23 24 31 32 33 40 46 47 64 65 79 81 82 86 87'
   co  = '2A 2B' }.GetEnumerator() |
  ForEach-Object { foreach ($d in $_.Value -split ' ') { $zoneOf[$d] = $_.Key } }
# Lieu trouve : libelle, coordonnees, zone
function Found($label, $g) {
  $r = @{ l = $label; p = @($g.Lat, $g.Lon) }
  if ($g.Dep) { $r.r = $(if ($zoneOf.ContainsKey($g.Dep)) { $zoneOf[$g.Dep] } else { 'hm' }) }
  return $r
}
function Locate($e) {
  $txt = "$($e.Title) | $($e.Tag) | $($e.Extract)"
  $s = SiteOf $e
  if ($s) {
    $inv = [Globalization.CultureInfo]::InvariantCulture
    return (Found $s.libelle ([pscustomobject]@{ Lat = [double]::Parse($s.lat, $inv); Lon = [double]::Parse($s.lon, $inv); Dep = $s.dep }))
  }
  $m = [regex]::Match($txt, $reAddr, 'IgnoreCase')
  if ($m.Success) { $g = Geo $m.Value; if ($g) { return (Found $m.Value $g) } }
  $m = [regex]::Match($e.Title, '^\s*\[([^\]]{2,40})\]')
  if ($m.Success) { $g = Geo $m.Groups[1].Value -City; if ($g) { return (Found (WithDep $g.City $g) $g) } }
  $m = [regex]::Match($e.Title, '^\s*([^:\[\]]{2,40}?)\s*:')
  if ($m.Success) { $g = Geo $m.Groups[1].Value -City; if ($g) { return (Found (WithDep $m.Groups[1].Value.Trim() $g) $g) } }
  $m = [regex]::Match($txt, 'D\u00e9partement\s+(du|de la|de l[''\u2019]|des|de)\s*([^:,.;|]+)', 'IgnoreCase')
  if ($m.Success) {
    $n = Norm $m.Groups[2].Value
    $hit = $depts.Keys | Where-Object { $n -eq $_ -or $n.StartsWith("$_ ") } | Sort-Object Length -Descending | Select-Object -First 1
    if ($hit) { $g = Geo $depts[$hit] -City; if ($g) { return (Found "$($g.City) (chef-lieu, $($m.Groups[2].Value.Trim()))" $g) } }
  }
  if ($txt -match '(?i)\bteams\b') { return @{ v = 'teams' } }
  if ($txt -match '(?i)webinaire|visio|en ligne|\u00e0 distance|distanciel|t\u00e9l\u00e9phone|site de vote') { return @{ v = 'distance' } }
  return @{ v = 'inconnu' }
}
foreach ($e in $events) { $e | Add-Member -NotePropertyName Loc -NotePropertyValue (Locate $e) -Force }

# ---------- Pages detail (pour le mode de participation) ----------
# La page d'un rendez-vous du site contient le texte complet et les liens, que la liste n'a pas :
# "Teams : cliquez ICI", "Pour y participer : c'est ICI" (lien raccourci cfeora.org/... vers Teams
# ou vers un fichier .ics), "Telephone au 01 88 ... Code : 964 004 706 #", "Presentiel sur le site
# ... Salle LAB GO (4eme etage)". Un lien vers Teams, un .ics, une visio ou un outil de reservation
# = distanciel ; avec en plus un lieu physique = hybride.
$reRemoteUrl = '(?i)teams\.microsoft\.com|teams\.live\.com|\.ics\b|zoom\.us|webex\.com|meet\.google\.|gotomeeting|goto\.com|livestorm|whereby\.com|jitsi|bluejeans|lifesize|starleaf|skype\.com|youtube\.com|youtu\.be|vimeo\.com|dailymotion|calendly|/bookings?/|outlook\.office(365)?\.com/book|doodle\.com|framadate|eventbrite|weezevent|klaxoon|webikeo'
$linkCache = @{}
# Destination d'un lien (suit jusqu'a 3 redirections, sans telecharger la page d'arrivee)
function Resolve($u) {
  if ($linkCache.ContainsKey($u)) { return $linkCache[$u] }
  $cur = $u
  for ($i = 0; $i -lt 3 -and $cur -notmatch $reRemoteUrl; $i++) {
    $loc = $null
    try {
      $q = [Net.HttpWebRequest]::Create($cur)
      $q.AllowAutoRedirect = $false; $q.Timeout = 8000
      $q.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AgendaBot'
      $resp = $q.GetResponse(); $loc = $resp.Headers['Location']; $resp.Close()
    } catch { $loc = $null }
    if (-not $loc) { break }
    $cur = [string][Uri]::new([Uri]$cur, $loc)
  }
  $linkCache[$u] = $cur
  return $cur
}
function Detail($e) {
  $res = @{ Text = ''; Remote = $false }
  if (-not $e.Url -or $e.Added) { return $res }
  try {
    $wc.Headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AgendaBot'
    $h = $wc.DownloadString($e.Url)
    $m = [regex]::Match($h, '(?s)<div class="single-post-grid-content">(.*?)(?:<hr class="separator"|<div class="single-post-grid-side)')
    if (-not $m.Success) { Log "AVERTISSEMENT page detail ($($e.Url)) : contenu introuvable"; return $res }
    $c = $m.Groups[1].Value
    $res.Text = Clean $c
    foreach ($a in [regex]::Matches($c, 'href="([^"]+)"')) {
      $u = [Net.WebUtility]::HtmlDecode($a.Groups[1].Value)
      if ($u -match $reRemoteUrl) { $res.Remote = $true; break }
      if ($u -notmatch '^https?://' -or $u -match '^https?://(www\.)?cfecgc-orange\.org/') { continue }
      if ((Resolve $u) -match $reRemoteUrl) { $res.Remote = $true; break }
    }
  } catch { Log "AVERTISSEMENT page detail ($($e.Url)) : $($_.Exception.Message)" }
  return $res
}
foreach ($e in $events) { $e | Add-Member -NotePropertyName Detail -NotePropertyValue (Detail $e) -Force }

# ---------- Mode de participation ----------
# p = presentiel, d = distanciel, h = hybride (indices des deux sortes, ex. "Orange Bridge, salle O.35,
# ou via Teams", ou "hybride"). Indices lus dans le titre, le libelle, l'extrait et la page detail.
# Distanciel : mots (Teams, webinaire, visio, en ligne...), lien Teams / .ics / visio / reservation,
# telephone + code de conference. Presentiel : presentiel, salle, etage, cafeteria, accueil cafe...,
# adresse postale, site Orange connu. Rien (= "non detecte") si rien ne permet de trancher :
# jamais "presentiel" par defaut, une simple ville ne suffit pas.
$reRemote = '\b(teams|webinaire|webinar|visio|visioconference|en ligne|a distance|distanciel|zoom|site de vote)\b'
$rePhone  = '\b(telephone|tel|audio|conference)\b.{0,60}?\b(code|id|pin)\b\s*\d'
$rePhys   = '\b(presentiel|sur place|accueils? cafe|cafe gourmand|cafeteria|salle|hall|batiment|etage|rdc|salon|stand|permanence|dejeuner|petit dejeuner)\b'
function Mode($e) {
  $raw = "$($e.Title) | $($e.Tag) | $($e.Extract) | $($e.Detail.Text)"
  $t = ' ' + (Norm $raw) + ' '
  if ($t -match '\bhybride\b') { return 'h' }
  $remote = ($t -match $reRemote) -or ($t -match $rePhone) -or $e.Detail.Remote
  $phys = ($t -match $rePhys) -or [regex]::IsMatch($raw, $reAddr, 'IgnoreCase')
  # Site Orange connu (memes regles que Locate : variantes, contexte) = present sur place
  if (-not $phys -and (SiteOf $e)) { $phys = $true }
  if ($phys -and $remote) { return 'h' }
  if ($phys) { return 'p' }
  if ($remote) { return 'd' }
  return $null
}
foreach ($e in $events) { $e | Add-Member -NotePropertyName Mode -NotePropertyValue (Mode $e) -Force }

# ---------- Rendez-vous sur plusieurs jours ----------
# Cherche dans le titre et la description une periode qui COMMENCE le jour du rendez-vous et finit plus tard :
#   "du lundi 7/12/2026 - 14h00 au jeudi 10/12/2026", "du 7 au 10 decembre", "du 7/12 au 10/12",
#   "07/12/26 - 10/12/26", "7 au 10 decembre", "du 7 decembre 14h au 8 decembre 12h",
#   "du 7 decembre 2026 au 15 janvier 2027", "les 7, 8 et 9 decembre", "jusqu'au 10 decembre",
#   "pendant 3 jours", "du lundi au jeudi".
# Resultat : nombre de jours en plus du premier (0 si rien, max 31) -> "+N jours", planning jusqu'a 18h, "4h+".
$months = @{ janvier = 1; fevrier = 2; mars = 3; avril = 4; mai = 5; juin = 6; juillet = 7; aout = 8; septembre = 9; octobre = 10; novembre = 11; decembre = 12 }
$wdays  = @{ lundi = 1; mardi = 2; mercredi = 3; jeudi = 4; vendredi = 5; samedi = 6; dimanche = 0 }
$reWd   = '(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?'
$reMn   = '(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)'
# Une date : 7/12, 07/12/26, 7/12/2026, ou 7, 1er, 7 decembre, 7 decembre 2026 (un nombre seul n'est pas suivi de h, :, / ou d'un chiffre)
$reDate = "\b(?:(?<nd>\d{1,2})/(?<nm>\d{1,2})(?:/(?<ny>\d{4}|\d{2}))?|(?<td>\d{1,2})(?:er)?(?!\s*h|\s*:|\d|/)(?:\s+(?<tm>$reMn))?(?:\s+(?<ty>\d{4}))?)\b"
# Ce qui peut separer deux dates d'une meme periode : heure eventuelle puis "au", "a", "jusqu'au", "-", "," ou "et"
$reLink = "^\s*(?:[-,]\s*)?(?:\d{1,2}\s*h\s*\d{0,2}\s*)?(?:-|,|et|au|a|jusqu'?au)\s*$reWd$"
function LowText($s) {
  $d = ([string]$s).Normalize([Text.NormalizationForm]::FormD)
  $d = [regex]::Replace($d, '\p{Mn}', '').ToLowerInvariant()
  $d = [regex]::Replace($d, '[\u2013\u2014]', '-').Replace([string][char]0x2019, "'")
  return [regex]::Replace($d, '\s+', ' ')
}
function ExtraDays($e) {
  $t = LowText "$($e.Title) . $($e.Extract)"
  $start = $e.Date.Date
  $best = 0
  # Dates trouvees dans le texte, dans l'ordre
  $ds = @(foreach ($m in [regex]::Matches($t, $reDate)) {
    if ($m.Groups['nd'].Success) {
      [pscustomobject]@{ I = $m.Index; E = $m.Index + $m.Length; D = [int]$m.Groups['nd'].Value; M = [int]$m.Groups['nm'].Value
                         Y = $(if ($m.Groups['ny'].Success) { $y = [int]$m.Groups['ny'].Value; if ($y -lt 100) { 2000 + $y } else { $y } } else { 0 }) }
    } else {
      [pscustomobject]@{ I = $m.Index; E = $m.Index + $m.Length; D = [int]$m.Groups['td'].Value
                         M = $(if ($m.Groups['tm'].Success) { $months[$m.Groups['tm'].Value] } else { 0 })
                         Y = $(if ($m.Groups['ty'].Success) { [int]$m.Groups['ty'].Value } else { 0 }) }
    }
  })
  # Chaines de dates reliees ("du A au B", "les A, B et C") : le premier element doit etre le jour du rendez-vous
  for ($i = 0; $i -lt $ds.Count; $i++) {
    $chain = @($ds[$i]); $j = $i
    while ($j + 1 -lt $ds.Count -and $t.Substring($ds[$j].E, $ds[$j + 1].I - $ds[$j].E) -match $reLink) { $j++; $chain += $ds[$j] }
    if ($chain.Count -lt 2) { continue }
    # Mois / annee manquants : repris de la date suivante (ou precedente), sinon ceux du rendez-vous
    $mon = $start.Month; $yr = $start.Year
    for ($k = $chain.Count - 1; $k -ge 0; $k--) { if ($chain[$k].M) { $mon = $chain[$k].M; break } }
    for ($k = $chain.Count - 1; $k -ge 0; $k--) { if ($chain[$k].Y) { $yr = $chain[$k].Y; break } }
    $a = $chain[0]
    $am = $(if ($a.M) { $a.M } else { $mon }); $ay = $(if ($a.Y) { $a.Y } else { $start.Year })
    if ($a.D -ne $start.Day -or $am -ne $start.Month -or $ay -ne $start.Year) { continue }
    $z = $chain[$chain.Count - 1]
    $zm = $(if ($z.M) { $z.M } else { $am }); $zy = $(if ($z.Y) { $z.Y } else { $yr })
    try { $end = New-Object DateTime $zy, $zm, $z.D } catch { continue }
    if ($end -le $start) { try { $end = $end.AddYears(1) } catch { continue } }   # "du 28 decembre au 3 janvier"
    $n = ($end - $start).Days
    if ($n -gt $best -and $n -le 31) { $best = $n }
  }
  # "jusqu'au [jour] 10 decembre" / "jusqu'au 10/12"
  foreach ($m in [regex]::Matches($t, "jusqu'?au\s+$reWd$reDate")) {
    $x = [regex]::Match($m.Value, $reDate)
    if ($x.Groups['nd'].Success) { $dd = [int]$x.Groups['nd'].Value; $mm = [int]$x.Groups['nm'].Value }
    elseif ($x.Groups['tm'].Success) { $dd = [int]$x.Groups['td'].Value; $mm = $months[$x.Groups['tm'].Value] }
    else { $dd = [int]$x.Groups['td'].Value; $mm = $start.Month }
    try { $end = New-Object DateTime $start.Year, $mm, $dd } catch { continue }
    if ($end -lt $start) { $end = $end.AddYears(1) }
    $n = ($end - $start).Days
    if ($n -gt $best -and $n -le 31) { $best = $n }
  }
  # "pendant 3 jours", "sur 2 jours"
  $m = [regex]::Match($t, '\b(?:pendant|sur|durant)\s+(\d{1,2})\s+jours\b')
  if ($m.Success) { $n = [int]$m.Groups[1].Value - 1; if ($n -gt $best -and $n -le 31) { $best = $n } }
  # "du lundi au jeudi" (sans dates) : seulement en dernier recours, si le rendez-vous tombe bien le premier
  # jour cite, et pas pour des horaires d'ouverture ("assistance du lundi au vendredi de 9h a 18h")
  $m = [regex]::Match($t, '\bdu\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+au\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b(?!\s*(?:,\s*)?(?:de|entre)\s+\d{1,2}\s*h)')
  if ($best -eq 0 -and $m.Success -and $wdays[$m.Groups[1].Value] -eq [int]$start.DayOfWeek) {
    $n = ($wdays[$m.Groups[2].Value] - $wdays[$m.Groups[1].Value] + 7) % 7
    if ($n -gt $best) { $best = $n }
  }
  return $best
}
foreach ($e in $events) { $e | Add-Member -NotePropertyName Days -NotePropertyValue (ExtraDays $e) -Force }

# ---------- Generation de la page ----------
# Donnees des rendez-vous (toute l'interface est rendue par app.js dans le navigateur)
$evData = @($events | ForEach-Object {
  $o = [ordered]@{ t = $_.Title; u = $_.Url; d = $_.Date.ToString('yyyy-MM-dd'); h = $_.Time; g = $_.Tag; x = $_.Extract }
  if ($_.Added) { $o.a = 1 }
  if ($_.Loc.p) { $o.l = $_.Loc.l; $o.p = $_.Loc.p; if ($_.Loc.r) { $o.r = $_.Loc.r } } else { $o.v = $_.Loc.v }
  if ($_.Mode) { $o.m = $_.Mode }
  # k : texte complet de la page detail, pour la recherche seulement (intervenants, details)
  if ($_.Detail.Text) { $o.k = $_.Detail.Text }
  if ($_.Days) { $o.j = $_.Days }
  $o
})
$evJson = ConvertTo-Json -InputObject $evData -Compress -Depth 3
$now   = ParisNow
$stamp = $now.ToString("dddd d MMMM yyyy '&agrave;' HH'h'mm", $fr)
# Version des fichiers statiques : change a chaque generation, pour que les navigateurs (Safari iPhone)
# rechargent style.css, app.js et travaux.svg au lieu de garder une ancienne copie en cache
$ver = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmm")
# Prochain passage planifie (8h, 14h, 18h heure de Paris, voir .github/workflows/update.yml)
$slot = @(8, 14, 18) | Where-Object { $_ -gt $now.Hour } | Select-Object -First 1
$next = if ($slot) { "${slot}h00" } else { 'demain 8h00' }
$nat  = $events.Count - $added
# Nombre d'evenements par origine. PC : "20 evenements (14 sur cfecgc-orange.org + 6 issus des emails)" ;
# mobile : "... + 6 mails)". Une origine a 0 n'est pas citee (sans parentheses), singulier si 1.
$tot  = $events.Count
function Site($txt) { "<a href=""$source"" target=""_blank"" rel=""noopener"">$txt</a>" }
function Plural($n) { if ($n -gt 1) { 's' } else { '' } }
function Counts($mailTxt, $siteTxt) {
  $site = Site $siteTxt
  $s = "<b>$tot</b> &eacute;v&eacute;nement$(Plural $tot)"
  if ($nat -and $added) { return "$s ($nat sur $site + $added $mailTxt)" }
  if ($added) { return "$s $mailTxt" }
  return "$s sur $site"
}
$mailLong  = "issu$(Plural $added) des emails"
$mailShort = $(if ($nat) { "mail$(Plural $added)" } else { "issu$(Plural $added) des mails" })
# PC (a droite des onglets, sur 2 lignes) : "Mis a jour le 07/11/2026 a 22:25 :" / compteurs
$stats = "Mis &agrave; jour le " + $now.ToString("dd/MM/yyyy '&agrave;' HH:mm", $fr) + " :<br>" + (Counts $mailLong "cfecgc-orange.org")
# Mobile (au-dessus des onglets), court : "25 evenements : 19 sur cfecgc-orange + 6 mails (maj : 08/11 a 10h)"
$cs = Counts $mailShort "cfecgc-orange"
if ($nat -and $added) { $cs = $cs -replace ' \(', ' : ' -replace '\)$', '' }   # "25 evenements : 19 sur ... + 6 mails"
$statsShort = $cs + " (m&agrave;j : " + $now.ToString("dd/MM '&agrave;' HH'h'", $fr) + ")"

# Icones (SVG en ligne, avec width/height pour rester petites meme sans CSS)
$svgA = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
$icoSearch = "<svg width=""16"" height=""16"" viewBox=""0 0 24 24"" $svgA><circle cx=""11"" cy=""11"" r=""7""/><path d=""m20 20-3.5-3.5""/></svg>"
$icoFunnel = "<svg width=""16"" height=""16"" viewBox=""0 0 24 24"" $svgA><path d=""M3 5h18l-7 8.5V19l-4 2v-7.5z""/></svg>"
$icoSun    = "<svg class=""ico-sun"" width=""18"" height=""18"" viewBox=""0 0 24 24"" $svgA><circle cx=""12"" cy=""12"" r=""4.5""/><path d=""M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4""/></svg>"
$icoMoon   = "<svg class=""ico-moon"" width=""18"" height=""18"" viewBox=""0 0 24 24"" $svgA><path d=""M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z""/></svg>"
$icoList   = "<svg width=""18"" height=""18"" viewBox=""0 0 24 24"" $svgA><rect x=""3"" y=""4.5"" width=""18"" height=""16"" rx=""2.5""/><path d=""M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h4M7.5 17h7""/></svg>"
$icoCal    = "<svg width=""18"" height=""18"" viewBox=""0 0 24 24"" $svgA><rect x=""3"" y=""4.5"" width=""18"" height=""16"" rx=""2.5""/><path d=""M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h.01M12 13.5h.01M16.5 13.5h.01M7.5 17h.01M12 17h.01""/></svg>"
$icoPin    = "<svg width=""18"" height=""18"" viewBox=""0 0 24 24"" $svgA><path d=""M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z""/><circle cx=""12"" cy=""9.5"" r=""2.5""/></svg>"
$icoPrev   = "<svg width=""18"" height=""18"" viewBox=""0 0 24 24"" $svgA><path d=""m15 18-6-6 6-6""/></svg>"
$icoNext   = "<svg width=""18"" height=""18"" viewBox=""0 0 24 24"" $svgA><path d=""m9 18 6-6-6-6""/></svg>"
$icoX      = "<svg width=""14"" height=""14"" viewBox=""0 0 24 24"" $svgA><path d=""M6 6l12 12M18 6 6 18""/></svg>"

$page = @"
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#faa82b">
<title>Agenda unifi&eacute; CFE-CGC Orange FC - &eacute;v&eacute;nements publics</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css">
<link rel="stylesheet" href="style.css?v=$ver">
<script>
  (function () {
    var t = null;
    try { t = localStorage.getItem('theme'); } catch (e) {}
    if (t !== 'light' && t !== 'dark') t = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  })();
</script>
</head>
<body>
<div class="frame">
<div class="topbar">
  <header class="banner">
    <h1><a href="./">Agenda unifi&eacute; <span class="nw">CFE-CGC Orange FC</span><small class="h1sub">&eacute;v&eacute;nements publics</small></a></h1>
    <span class="wipbox"><button type="button" class="wip-btn" id="wipBtn" aria-expanded="false" aria-controls="wipTip" aria-label="Site en test : informations"><img class="wip" src="travaux.svg?v=$ver" alt="Site en travaux : test en cours" width="55" height="48"></button><span class="wip-tip" id="wipTip" role="tooltip" hidden>Version de d&eacute;monstration en cours de test ! Certains &eacute;v&eacute;nements peuvent &ecirc;tre manquants (notamment ceux diffus&eacute;s par mail)</span></span>
    <div class="bn-tools">
      <button type="button" class="bn-btn" id="qBtn" aria-label="Rechercher" aria-expanded="false" aria-controls="q">$icoSearch</button>
      <div class="search" role="search">
        $icoSearch
        <input type="search" id="q" placeholder="Rechercher un &eacute;v&eacute;nement&hellip;" aria-label="Rechercher un &eacute;v&eacute;nement (titre, description, lieu, intervenant)" autocomplete="off" spellcheck="false">
        <kbd id="qKey">Ctrl + K</kbd>
        <button type="button" class="clr" id="qClear" aria-label="Effacer la recherche" hidden>$icoX</button>
      </div>
      <button type="button" class="bn-btn" id="fltBtn" aria-expanded="false" aria-controls="rpane">$icoFunnel<span class="lbl">Filtres</span><span class="fn" id="fltN"></span></button>
      <button type="button" class="bn-btn bn-theme" id="themeBtn" role="switch" aria-checked="false">$icoSun$icoMoon<span class="lbl">Mode nuit</span><span class="sw" aria-hidden="true"><span class="knob"></span></span></button>
    </div>
  </header>
  <div class="navbar">
    <nav class="tabs" role="tablist" aria-label="Vues de l&#39;agenda">
      <button type="button" class="tab" role="tab" id="tab-jour" data-tab="jour" aria-controls="vJour" aria-selected="true">$icoList<span class="lg">Prochains &eacute;v&eacute;nements</span><span class="sh">Prochains</span></button>
      <button type="button" class="tab" role="tab" id="tab-cal" data-tab="cal" aria-controls="vCal" aria-selected="false" tabindex="-1">$icoCal<span class="lg">Agenda (Calendrier)</span><span class="sh">Calendrier</span></button>
      <button type="button" class="tab" role="tab" id="tab-carte" data-tab="carte" aria-controls="vCarte" aria-selected="false" tabindex="-1">$icoPin<span class="lg">Carte des &eacute;v&eacute;nements</span><span class="sh">Carte</span></button>
    </nav>
    <p class="sub"><span class="lg">$stats</span><span class="sh">$statsShort</span></p>
  </div>
</div>
  <main class="cols">
    <section class="col col-left" aria-label="Navigation">
      <div class="view" id="vJour" role="tabpanel" aria-labelledby="tab-jour">
        <div class="days">
          <button type="button" class="nav" id="prev" aria-label="Dates pr&eacute;c&eacute;dentes">$icoPrev</button>
          <ol class="chips" id="chips"></ol>
          <button type="button" class="nav" id="next" aria-label="Dates suivantes">$icoNext</button>
        </div>
        <div class="planbox" id="plan"></div>
      </div>
      <div class="view" id="vCal" role="tabpanel" aria-labelledby="tab-cal" hidden></div>
      <div class="view" id="vCarte" role="tabpanel" aria-labelledby="tab-carte" hidden>
        <div class="mapbar" id="mapBar"></div>
        <div id="map" role="region" aria-label="Carte des rendez-vous par lieu"></div>
      </div>
    </section>
    <section class="col col-right" aria-label="Rendez-vous">
      <div class="rpane" id="rpane"></div>
    </section>
  </main>
  <footer>Prochaine mise &agrave; jour des donn&eacute;es vers $next<span class="ft-pc"> - les liens &laquo; Voir le d&eacute;tail &raquo; ouvrent le site d'origine.</span></footer>
</div>
<script>window.EVENTS = $evJson;</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js"></script>
<script src="app.js?v=$ver"></script>
<!-- Statistiques de visite anonymes (GoatCounter : sans cookie ni donnee personnelle), tableau de bord sur bricebrice2.goatcounter.com -->
<script data-goatcounter="https://bricebrice2.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
</body>
</html>
"@

$tmp = "$outFile.tmp"
[IO.File]::WriteAllText($tmp, $page, (New-Object Text.UTF8Encoding $false))
Move-Item -Force $tmp $outFile
Log "OK : $($events.Count) rendez-vous"

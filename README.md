# CNC risalnik

Spletna aplikacija za delavnico: narišeš kos (ali ga izbereš iz predloge) in dobiš program za CNC rezkar.
Privzeti izvoz je **SCM Xilog Plus (.xxl)**, na voljo so tudi G-koda (GRBL, Mach3, LinuxCNC, ISO), DXF in SVG.

## Zagon

Dvoklikni `cnc-risalnik.html`. Odpre se v brskalniku in deluje brez interneta (potreben je samo za pisavo).
Projekti se sproti shranjujejo v brskalnik; z gumbom **Shrani projekt** dobiš datoteko `.json`, ki jo kasneje odpreš z **Odpri**.

## Mapa

| Datoteka | Kaj je |
| --- | --- |
| `cnc-risalnik.html` | Celotna aplikacija v eni datoteki – to uporabljaš. |
| `src/core.js` | Geometrija, odmik orodja, žepi, mostički, izvoz G-koda / XXL / DXF / SVG. |
| `src/templates.js` | Predloge (korpus, predal, plošča z luknjami, fronta, okrogla plošča) in razporejanje kosov na ploščo. |
| `src/app.js` | Uporabniški vmesnik: risanje, izbira, nastavitve, izvoz. Na vrhu je `CONFIG` (ime podjetja, barva, logotip). |
| `src/template.html` | HTML in CSS ogrodje. |
| `src/build.py` | Združi datoteke iz `src/` v `cnc-risalnik.html`. |

Po spremembi kode v `src/` zaženi:

```bash
cd src
python3 build.py
```

To ustvari nov `src/cnc-risalnik.html`; prekopiraj ga eno mapo višje.

## Koordinate pri izvozu XXL

- X = 0 levi rob, Y = 0 spodnji rob, **Y pozitivno navzdol** (točke nad spodnjim robom imajo negativen Y).
- Vrtine `B`: Z = globina v material (pozitivno). Rezkanje `XG0/XL2P/XAR2`: Z negativno = globina.
- Luknja, katere premer se ujema s svedrom iz nastavitev (privzeto ⌀5 = T119, ⌀8 = T110), gre v vrstico `B`.

## Še ni preverjeno na stroju

Vrtine `B` so v enaki obliki kot referenčni `part8.xxl`. Rezkanje (izrez, utori, žepi) temelji na javnih primerih Xilog in ga je treba preveriti:

1. številka orodja rezkarja (privzeto T101),
2. enota hitrosti `V` (predpostavljeno mm/min),
3. smer lokov `G=2/3` (zaradi obrnjenega Y),
4. ali stroj zahteva `GIN`/`XGIN` pred profilom.

Najprej odpri program v urejevalniku Xilog in preglej izris, nato prvi rez poženi »po zraku« (dvignjen Z).

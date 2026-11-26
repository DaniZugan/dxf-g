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
| `src/app.js` | Uporabniški vmesnik: risanje, izbira, nastavitve, izvoz. Na vrhu je `CONFIG` (ime podjetja, zlata barva Alfastreet, logotip). |
| `logo.png` | (neobvezno) Logotip Alfastreet – če datoteka obstaja v isti mapi, se prikaže v glavi namesto napisa. |
| `src/template.html` | HTML in CSS ogrodje. |
| `src/build.py` | Združi datoteke iz `src/` v `cnc-risalnik.html`. |

Po spremembi kode v `src/` zaženi:

```bash
cd src
python3 build.py
```

To ustvari nov `src/cnc-risalnik.html`; prekopiraj ga eno mapo višje.

## Izvoz XXL (SCM Xilog)

Oblika je narejena po programih SolidCAM za ta stroj (`Examples/PART2.xxl`, `-PART3.xxl` v veji `stara-verzija`) in po `part8.xxl`:

- Glava `H DX DY DZ-IL ... BX=0 BY=0 BZ=0 V=10`, nato `IX/IY/ROT/PL/C=0/F=1`, vsaka operacija ima svoj odsek `PL ...` + `O X=0 Y=0 Z=0 F=1 ;Offset`, konec `F=1` / `N X=0`.
- Koordinate: X = 0 levi rob, **Y_stroj = −y** (točke nad spodnjim robom imajo negativen Y), **Z = globina v material (pozitivno)**.
- Hitrost `V` je v m/min (pomik 6000 mm/min → `V=6`).
- Zunanji obris in notranji izrez: pot gre **po robu kosa** s `C=1` (stroj sam zamakne za polmer rezkarja), vstop in izstop po četrtinskem loku `XA2P` z radijem 22 mm, `G=2` = v smeri urinega kazalca na risbi. Zunanji `D=25`, notranji `D=43` (kot SolidCAM).
- Luknja s premerom, ki ustreza svedru (privzeto ⌀8 = T2, ⌀5 = T119), gre v vrstico `B`.

## Še ni preverjeno na stroju

1. **Žepi, utori in gravure** – v primerih SolidCAM jih ni; izvožene so z `XG0 ... C=0` (brez korekcije, pot po sredini rezkarja).
2. **Pomen parametra `D`** pri `XG0` – vrednosti 25/43 so prepisane iz primerov.
3. **Orodja**: SolidCAM primeri uporabljajo T1 (rezkar ⌀20) in T2 (sveder ⌀8), `part8.xxl` pa T110 (⌀8) in T119 (⌀5). Preveri, katera tabela orodij velja.

Najprej odpri program v urejevalniku Xilog in preglej izris, nato prvi rez poženi »po zraku« (dvignjen Z).

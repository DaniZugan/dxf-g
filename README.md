# DXF to XXL

Pretvornik iz enostavnega 2D DXF v `.xxl` CNC dialekt iz mape `Examples`.

## Uporaba

```bash
python3 dxf_to_xxl.py "Examples/part2 dxf.DXF" -o part2.xxl --thickness 18
```

## Lokalni vmesnik

```bash
python3 app.py
```

Nato odpri:

```text
http://127.0.0.1:8765
```

## GitHub Pages verzija

Staticna verzija je v mapi `web/` in dela brez Python serverja. DXF se pretvori direktno v browserju.

Lokalno lahko odpres:

```text
web/index.html
```

Za objavo na GitHub Pages:

1. Pushni projekt na GitHub.
2. V repozitoriju odpri `Settings` -> `Pages`.
3. Pri `Build and deployment` izberi `GitHub Actions`.
4. Workflow `.github/workflows/pages.yml` objavi mapo `web/`.

Po objavi bo stran na:

```text
https://<uporabnik>.github.io/<repo>/
```

Za lastno domeno v GitHub Pages nastavis `Custom domain`.

Privzeta pravila:

- DXF `CIRCLE` z radiusom 4 mm je moznik in postane vrtanje z orodjem `T=2`.
- Mozniki se vedno vrtajo na tocno podan `--drill-depth`.
- Zaprte `LINE`/`ARC` konture postanejo rezkanje z `T=1`.
- CNC koordinata `Y` je negativ DXF koordinati, skladno z obstoječimi `.xxl` primeri.
- Ce je podan `--thickness`, je vrtanje do debeline materiala, rezkanje pa do `thickness + 2`.
- Rezkanje gre privzeto po prehodih največ 10 mm (`--max-pass-depth 10`).
- `--max-pass-depth 0` naredi en sam prehod na končno globino.

Primeri:

```bash
python3 dxf_to_xxl.py Examples/part1.DXF -o part1.xxl --drill-depth 10
python3 dxf_to_xxl.py "Examples/part2 dxf.DXF" -o part2.xxl --thickness 18 --max-pass-depth 0
python3 dxf_to_xxl.py Examples/part3.DXF -o part3.xxl --cut-depth 20 --drill-depth 10
```

`Q`, `R` in `D` so izpisani zaradi oblike obstojece kode, po navodilih pa niso bistveni.

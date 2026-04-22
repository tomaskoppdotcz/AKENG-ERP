# AKENG ERP — Ruční regresní checklist (po visual phase 2)

> Účel: stabilizační vrstva po velkém množství změn napříč výrobou, skladem, fulfillmentem, work reports, metrikami, search, table layouts a overview/detail UI.
>
> Formát: každý scénář má **Předpoklad → Kroky → Očekávaný výsledek**. Prochází se **ručně** v UI (případně s DB inspekcí u návazností).

---

## Jak s checklistem pracovat

1. Před začátkem pořiď zálohu DB (`akeng_erp_v1.db` → `akeng_erp_v1.db.bak_<datum>`).
2. Procházej moduly v uvedeném pořadí — pozdější moduly (metriky, audit) testují návaznosti dřívějších akcí.
3. U každého testu zaškrtni výsledek:
   - `[x]` OK
   - `[!]` Problém (doplň stručnou poznámku + screenshot)
   - `[-]` Neaplikovatelné / přeskočeno (doplň proč)
4. Po dokončení ulož výstup jako `docs/testing/runs/<YYYY-MM-DD>_regression.md`.

### Testovací data / prerekvizity

- Min. 1 zákazník, 1 zaměstnanec (čip + PIN), 1 pracoviště.
- Min. 2 portfolio položky:
  - jedna **s aktivním TP** (plně naplánovatelná),
  - jedna **bez TP** (ověří chybové stavy).
- Min. 1 materiálová položka ve skladu s min. zásobou.
- Min. 1 skladová lokace pro výrobky i pro materiál.
- Min. 2 účty s různými rolemi (např. `admin` a `operator`) pro ověření RBAC.

---

## 1) Zakázky

### 1.1 Vytvoření nové zakázky

- **Předpoklad:** Existuje zákazník; UI role = admin / sales.
- **Kroky:**
  1. Zakázky → Nová zakázka.
  2. Vyber zákazníka, zadej číslo objednávky, datum, termín expedice.
  3. Ulož.
- **Očekávaný výsledek:**
  - V přehledu se objeví nový řádek s kódem zakázky.
  - V detailu (Karta zakázky) velký VP-like kód vlevo nahoře, badge „Aktivní", sekce **Stav zakázky** s vyplněnými poli, KPI **Provozní metriky** ukazují 0 položek / 0 kusů / 0 Kč.

### 1.2 Přidání položky (GPN) s existující TP

- **Předpoklad:** Portfolio položka s `active_template_id` a prodejní cenou.
- **Kroky:**
  1. V kartě zakázky → **Přidat položku**.
  2. Zadej / vyber GPN, množství, termín.
  3. Ulož.
- **Očekávaný výsledek:**
  - Řádek v sekci **Položky zakázky** má plnou identifikaci (GPN, název, výkres, revize, materiál).
  - KPI **Prodejní cena** se zvýšila o `množství × sale_price_per_piece`.
  - „Položek celkem" +1, „Kusů celkem" += množství.

### 1.3 Přidání položky bez aktivní TP

- **Předpoklad:** Portfolio položka bez `active_template_id`.
- **Kroky:** Stejné jako 1.2.
- **Očekávaný výsledek:**
  - Položka jde přidat, ale **Vytvořit VP** u ní vrací chybu „Portfolio položka nemá aktivní technologický postup" (nebo ekvivalent).
  - Žádný VP se nevytvoří (DB: `production_orders` beze změny).

### 1.4 Vytvoření VP z položky

- **Předpoklad:** 1.2 úspěšně splněno.
- **Kroky:**
  1. U položky → **Vytvořit VP**.
  2. Projdi případný restock preview (pokud je fulfillment režim).
- **Očekávaný výsledek:**
  - Vznikne VP s `vp_code`, operacemi z TP, stavem „Naplánováno".
  - Karta zakázky zobrazuje u položky odkaz na VP.
  - Backend: `production_orders` +1, `production_order_operations` odpovídající TP.

### 1.5 Storno zakázky

- **Předpoklad:** Zakázka je aktivní, nemá žádné běžící VP.
- **Kroky:**
  1. V kartě zakázky → **Stornovat zakázku** → potvrdit.
- **Očekávaný výsledek:**
  - Badge v headeru přepnutý na **Stornováno** (červený).
  - Nad headerem se objeví červený warning „Tato zakázka je stornována…".
  - Tlačítka **Upravit / Vytvořit VP / Přidat položku** jsou disabled.
  - V přehledu zakázek je filtr **Stornované** zobrazuje a **Vše** je zahrnuje.

### 1.6 Úprava hlavičky zakázky

- **Předpoklad:** Aktivní zakázka.
- **Kroky:**
  1. **Upravit zakázku** → změň zákazníka, PO č., datum, termín, poznámku.
  2. Ulož.
- **Očekávaný výsledek:**
  - Header + sekce „Stav zakázky" odráží změny.
  - Původní VP a položky zůstávají napojené (nedojde k smazání navazujících záznamů).

### 1.7 Prodejní cena — součty

- **Předpoklad:** Alespoň 2 položky s různou cenou.
- **Kroky:** Přidej/odeber položky a sleduj KPI **Prodejní cena**.
- **Očekávaný výsledek:** Suma = Σ `množství × sale_price_per_piece` (bez DPH). Po stornu zakázky stále viditelná (historická hodnota).

---

## 2) Výrobní příkazy (VP)

### 2.1 Přehled VP — KPI a filtry

- **Předpoklad:** Existuje ≥ 1 VP v každém stavu (Naplánováno, Běží, Hotovo, Storno).
- **Kroky:**
  1. Otevři **Výrobní příkazy**.
  2. Přepínej „Typ přehledu" a „Stav zakázky".
- **Očekávaný výsledek:**
  - 6 KPI dlaždic (Celkem / Aktivní / Běží / Hotovo / Po termínu / K expedici) jsou barevně rozlišené + hover lift.
  - Filtry okamžitě přepočítávají tabulku i KPI.
  - Řádek tabulky má při hoveru jemné šedé pozadí + **modrý levý border 4 px**.

### 2.2 Detail VP — vizuální hierarchie

- **Předpoklad:** VP v běhu.
- **Kroky:** Otevři detail VP (kliknutím na kód).
- **Očekávaný výsledek:**
  - **Header**: velký `vp_code` (28 px, primary), pod ním název produktu, pak subtitle.
  - **Headeraside**: status badge + **Hotovo (operace) XX%** velké + progress line.
  - **Aktuální stav výroby** (gradient modro-bílá karta): Poloha, Aktuální operace, Další operace.
  - **Provozní metriky**: Vykázaný čas / Náklad práce / Hotovo % / Výkonnost.
  - **Identifikace a objednávka** + **Portfolio a zdroj** subtilní.
  - **Technologický proces** jako poslední sekce.

### 2.3 Storno VP

- **Předpoklad:** VP Naplánováno / Běží.
- **Kroky:** **Stornovat VP** → potvrdit.
- **Očekávaný výsledek:**
  - VP stav = Storno.
  - Operace přestanou blokovat plánování; materiál vrácený podle logiky fulfillmentu (ověř v DB `material_stock_movements`).
  - V přehledu filter „Stornované" zobrazí.

### 2.4 Regenerate VP z TP (per VP)

- **Předpoklad:** VP Naplánováno **bez** reportovaného času na operacích.
- **Kroky:** **Regenerovat z TP** → potvrdit.
- **Očekávaný výsledek:**
  - Operace VP odpovídají aktuální verzi TP.
  - Pokud je na některé operaci již běh/hotovo → operace je blokována a UI zobrazí varování „Regenerace blokována — na operacích je reportovaný čas".

### 2.5 Nulové / nesmyslné stavy

- **Kroky:** Otevři VP, kde `reported_time_min = 0`, `completion_percent = 0`.
- **Očekávaný výsledek:**
  - KPI v headeru zobrazují `0 min`, `0 Kč`, `0 %`, `—` (žádné `NaN`, `Infinity`, `undefined`).

---

## 3) Sklad výrobků

### 3.1 Přehled — KPI + search

- **Předpoklad:** ≥ 2 skladové karty s různým stavem (1 pod min., 1 v normálu).
- **Kroky:**
  1. Otevři **Sklad výrobků**.
  2. Pozoruj KPI (Položek / Po filtru / Součet stavu).
  3. Napiš do searche část GPN, pak část názvu, pak scan kód.
- **Očekávaný výsledek:**
  - 3 KPI dlaždice ve stylu VP (gradient + accent + hint).
  - Search má pastelový placeholder (#475569), focus zvýrazní rámeček.
  - Po filtru se KPI **Po filtru** mění v reálném čase.

### 3.2 Vytvoření skladové karty

- **Předpoklad:** Portfolio položka bez existující karty.
- **Kroky:** **Nová skladová karta** → vyber portfolio, lokaci, stav, min. zásobu → Uložit.
- **Očekávaný výsledek:** Nový řádek v tabulce, v detailu karty header s GPN, status badge „Aktivní".

### 3.3 Pohyby — Příjem / Výdej / Korekce

- **Předpoklad:** Existuje skladová karta s `current_qty = 10`.
- **Kroky:**
  1. Detail karty → **Přidat pohyb** → Příjem 5 ks → Uložit.
  2. Výdej 3 ks.
  3. Korekce −2 ks.
- **Očekávaný výsledek:**
  - `current_qty` po krocích: 15 → 12 → 10.
  - Tabulka pohybů má 3 řádky seřazené sestupně.
  - KPI **Počet pohybů** = 3, **Poslední pohyb** = aktuální timestamp.

### 3.4 Stock receipt na SPRÁVNOU kartu (regresní bod)

- **Předpoklad:** VP s portfolio_item_id X, existuje sklad karta pro X.
- **Kroky:**
  1. Otevři VP, dokonči operace včetně **Příjem sklad**.
  2. Zadej množství a lokaci.
- **Očekávaný výsledek:**
  - `product_stock_items.current_qty` karty **pro portfolio_item_id X** se zvýší (ne pro jinou položku).
  - V DB: `product_stock_movements` nový řádek `movement_type=prijem`, `reference` obsahuje VP kód.
  - Chyba, kterou kdysi řešil fix „portfolio_item_id" se **nesmí vrátit** — tj. nesmí se navýšit jiná karta (ověř i když jsou dvě karty s podobným GPN, jinou revizí).

### 3.5 Pod min. zásobou — vizuální indikace

- **Předpoklad:** Karta s `min_qty = 10`, `current_qty = 3`.
- **Kroky:** Otevři detail karty.
- **Očekávaný výsledek:** V „Aktuální stav skladu" je hodnota červeně + badge „pod min." (uppercase, letterSpacing).

---

## 4) Sklad materiálu

### 4.1 Přehled — KPI + filtry + overview card

- **Předpoklad:** ≥ 3 materiálové karty, různé skupiny a formy.
- **Kroky:**
  1. Otevři **Sklad materiálu**.
  2. Ověř KPI (Položek / Po filtru / Pod min. zásobou).
  3. Filtruj podle skupiny, formy, searche.
- **Očekávaný výsledek:**
  - Struktura je `overviewMainCard` + header band (search + group + form) + body.
  - KPI se mění s filtrem.

### 4.2 Pohyb příjem s trace fields

- **Předpoklad:** Materiálová karta.
- **Kroky:**
  1. Detail karty → **Přidat pohyb** → Příjem 1000 mm.
  2. Vyplň **Tavba / šarže** (povinné), Dodavatel, DL, Atest.
  3. Nahraj PDF / JPG přílohu.
- **Očekávaný výsledek:**
  - Pohyb uložen. Příloha přístupná přes odkaz v tabulce.
  - `current_qty += 1000`. KPI „Počet pohybů" +1, „Poslední příjem" = nyní.

### 4.3 Příjem bez tavby / šarže

- **Kroky:** Stejné jako 4.2, ale nech „Tavba / šarže" prázdné.
- **Očekávaný výsledek:** UI chyba „U příjmu je povinné pole Tavba / šarže". Pohyb se neuloží.

### 4.4 Výdej a korekce

- **Kroky:** Výdej 200 mm, Korekce −50 mm.
- **Očekávaný výsledek:**
  - `current_qty` správně upraveno.
  - Pod-min. indikace se aktivuje, jakmile hodnota klesne pod `min_qty`.

### 4.5 Konzumpce při výrobě

- **Předpoklad:** VP s polotovarem vyžadujícím materiál X.
- **Kroky:** Spustit a dokončit příslušné operace VP.
- **Očekávaný výsledek:**
  - V `material_stock_movements` se objeví `movement_type=vydej` s referencí na VP.
  - Karta ve skladu materiálu má snížené `current_qty` o očekávanou spotřebu.

---

## 5) Fulfillment sklad / WIP / výroba

### 5.1 Pokrytí ze skladu — 100 %

- **Předpoklad:** Zakázka, položka 10 ks; portfolio má kartu se `current_qty = 15`.
- **Kroky:**
  1. Vytvoř VP z položky.
  2. Projdi restock preview (pokud se objeví).
- **Očekávaný výsledek:**
  - Fulfillment rozhodnutí: **plně pokryto ze skladu** (v auditu `audit fulfillment decisions`).
  - VP pro zákazníka se **nevytvoří**; vznikne pouze výdej z karty (nebo dle logistického režimu VP bez operací).

### 5.2 Pokrytí ze skladu — částečné

- **Předpoklad:** `current_qty = 4`, objednané 10 ks.
- **Kroky:** Vytvoř VP.
- **Očekávaný výsledek:**
  - 4 ks výdej ze skladu, 6 ks → VP s operacemi.
  - V Kartě zakázky je u položky viditelné „Pokryto ze skladu: 4 / 10" (nebo ekvivalent label).

### 5.3 Kombinovaný scénář sklad + WIP + výroba

- **Předpoklad:** Sklad má 3 ks, ve WIP je 2 ks rozběhnuté, objednané 10 ks.
- **Kroky:** Vytvoř VP.
- **Očekávaný výsledek:**
  - Fulfillment správně započítá: 3 sklad + 2 WIP + 5 nová výroba.
  - Audit záznam obsahuje rozpad hodnot.

### 5.4 Konflikt — doplnění skladu vs. zakázka

- **Předpoklad:** Pro stejný GPN běží restock a zároveň vzniká nová zakázka.
- **Kroky:** Vytvoř VP, v preview vyber volbu (vzít z restocku / vyrobit nové).
- **Očekávaný výsledek:**
  - Modal „Konflikt: doplnění skladu vs. zakázka" se zobrazí s možnostmi.
  - Po potvrzení je rozhodnutí zapsané v auditu a reflektuje se v VP.

### 5.5 Storno VP uprostřed fulfillment řetězce

- **Předpoklad:** VP běží, část je už vyrobená.
- **Kroky:** Stornuj VP.
- **Očekávaný výsledek:**
  - Hotová část zůstává na kartě skladu (nevrací se).
  - Nespotřebovaný materiál se **vrátí** na sklad (ověř `material_stock_movements`).
  - Audit fulfillment rozhodnutí obsahuje stornovou událost.

---

## 6) Planner

### 6.1 Same-day scheduling (regresní bod)

- **Předpoklad:** VP vytvořený dnes, pracoviště volné dnes.
- **Kroky:**
  1. Otevři planner.
  2. Klikni na operaci → naplánuj na dnešek.
- **Očekávaný výsledek:**
  - Operace se naplánuje na dnešek (ne až na další pracovní den).
  - `actual_start` / `planned_start` je dnes v lokálním čase.

### 6.2 Split přes dny

- **Předpoklad:** Operace delší než zbývající pracovní čas dne.
- **Kroky:** Naplánuj.
- **Očekávaný výsledek:**
  - Operace se rozdělí na 2+ směny bez přerušení kontextu (pokračuje další pracovní den).
  - V plánu je viditelné rozdělení.

### 6.3 Replanning po HOTOVO

- **Předpoklad:** Operace 1 hotová dříve než plánovaný konec.
- **Kroky:** Označ HOTOVO.
- **Očekávaný výsledek:**
  - Následující operace se **automaticky posunou dopředu** (nečekají na původní plánovaný čas).
  - `production_orders.status` se přepočítá (např. z „Naplánováno" na „Běží" pokud další operace startuje hned).

### 6.4 Návaznosti operací

- **Předpoklad:** TP s pořadím A → B → C.
- **Kroky:** Naplánuj VP.
- **Očekávaný výsledek:**
  - B nemůže začít před koncem A; C před koncem B.
  - Při pokusu o ruční posun porušující návaznost planner odmítne / varuje.

### 6.5 Blokace navazujících operací

- **Předpoklad:** Operace B čeká na A.
- **Kroky:** Otevři kiosk → vyber operaci B.
- **Očekávaný výsledek:**
  - Tlačítko START je disabled s hláškou „Předchozí operace není hotová".

---

## 7) Kiosk / shopfloor

### 7.1 Login čipem

- **Předpoklad:** Zaměstnanec s přiřazeným čipem.
- **Kroky:** V kiosku přiložit čip / zadat PIN / scan kódu.
- **Očekávaný výsledek:**
  - Login úspěšný, zobrazí se operátorovo jméno.
  - `actor` v auditu následujících akcí = ten zaměstnanec.

### 7.2 START / PAUZA / RESUME / HOTOVO

- **Předpoklad:** Operace naplánovaná pro dnešek.
- **Kroky:**
  1. START
  2. (po 2 min) PAUZA → vyber důvod
  3. RESUME
  4. HOTOVO → zadej OK / NOK kusy, poznámku
- **Očekávaný výsledek:**
  - `operation_events` má záznamy start / pause / resume / done s korektními časy.
  - `work_reports` má záznam s `duration_min` = čistý čas (bez pauzy).
  - VP completion % se zvedne.

### 7.3 Pauzy s různými důvody

- **Kroky:** Proveď 2× PAUZA s různým důvodem.
- **Očekávaný výsledek:**
  - Oba důvody uloženy na `operation_events`.
  - Celková pauza = součet; `duration_min` = `actual_end - actual_start - pauzy`.

### 7.4 Shopfloor vs. PC kiosk — sjednocení

- **Kroky:** Spusť operaci na shopfloor kiosku a dokonči na PC kiosku (u stejné operace).
- **Očekávaný výsledek:**
  - Jeden souvislý záznam, žádné duplicity `work_reports`.
  - Actor u START a HOTOVO může být stejný nebo rozdílný — oba se uloží.

---

## 8) Výkazy práce

### 8.1 Ruční vytvoření výkazu

- **Předpoklad:** Operace bez běžícího kiosku.
- **Kroky:**
  1. Výkazy práce → **Přidat výkaz**.
  2. Vyber VP, operaci, zaměstnance, čas od/do, OK/NOK kusy, poznámku.
  3. Ulož.
- **Očekávaný výsledek:**
  - `work_reports` nový záznam.
  - `reported_time_min` VP + operace se zvedne.
  - Hotovo % se přepočítá.

### 8.2 Úprava výkazu

- **Kroky:** Uprav čas a počty na existujícím výkazu.
- **Očekávaný výsledek:**
  - Metriky VP se přepočítají na novou hodnotu (ne kumulativně).

### 8.3 Rollback po smazání výkazu (regresní bod)

- **Předpoklad:** Operace s 1× work_reportem, který udělal z operace HOTOVO.
- **Kroky:** Smaž výkaz.
- **Očekávaný výsledek:**
  - Operace se **re-otevře** (status zpět na „Běží" nebo „Naplánováno").
  - `reported_time_min` operace i VP se sníží o smazanou hodnotu.
  - `production_orders.status` se přepočítá (VP nebude už „Hotovo").
  - Pokud byl `Příjem sklad` navázán — ověř v DB, že se skladový pohyb vrátil (podle byznys logiky).

### 8.4 Manual completion (náhrada HOTOVO)

- **Předpoklad:** Operace nebyla ukončena z kiosku.
- **Kroky:** Přes ruční výkaz zadat čas a HOTOVO flag.
- **Očekávaný výsledek:**
  - Operace se označí jako hotová.
  - `operation_events` má `done` událost s `manual=true` (nebo ekvivalent marker).
  - Navazující operace se odblokují.

### 8.5 Výkaz bez PIN / actor

- **Kroky:** Zkus uložit výkaz bez zaměstnance.
- **Očekávaný výsledek:** Validace odmítne — výkaz bez operátora nelze uložit.

---

## 9) Metriky VP / položka / zakázka

### 9.1 Agregace VP

- **Předpoklad:** VP s několika operacemi, některé HOTOVO, některé Naplánováno.
- **Kroky:** Otevři detail VP.
- **Očekávaný výsledek:**
  - `completion_percent` = (hotové operace / všechny operace) × 100 (nebo podle metodiky definované v backend — ověř konzistentně mezi overview a detailem).
  - `reported_time_min` = Σ `work_reports.duration_min` pro daný VP.
  - `direct_labor_cost` = Σ `duration_min × hourly_rate / 60` (ověř proti manual kalkulaci).
  - `performance_percent` = plánovaný čas / skutečný čas (nebo dle definice).

### 9.2 Agregace položky zakázky

- **Předpoklad:** Položka s 2 VP (např. částečné pokrytí ze skladu + nová výroba).
- **Kroky:** Otevři Kartu zakázky.
- **Očekávaný výsledek:**
  - Součty napříč VP jsou konzistentní s jednotlivými VP.

### 9.3 Agregace zakázky

- **Kroky:** Zkontroluj KPI „Prodejní cena" / „Položky celkem" / „Kusů celkem" v detailu zakázky vs. přehled zakázek.
- **Očekávaný výsledek:** Hodnoty se shodují (na haléř) mezi detailem a přehledem.

### 9.4 Hotovo % — konzistence overview vs. detail

- **Kroky:** V přehledu VP si všimni `hotovo` u VP X, pak otevři detail.
- **Očekávaný výsledek:** Stejné % (ne off-by-one, ne zaokrouhlovací rozdíl > 1 %).

### 9.5 Výkonnost

- **Předpoklad:** Operace s plánovaným i skutečným časem.
- **Kroky:** Otevři detail VP → KPI **Výkonnost**.
- **Očekávaný výsledek:**
  - > 100 % = rychleji než plán, < 100 % = pomaleji než plán.
  - Při nulovém plánovaném čase se zobrazí `—` (žádné dělení nulou).

### 9.6 Nulové KPI

- **Kroky:** Otevři VP bez reportovaného času.
- **Očekávaný výsledek:** Žádné `NaN` / `Infinity` / `undefined` v UI. Zobrazí se `0`, `—` nebo `0 %`.

---

## 10) Table layouts + search

### 10.1 Table layout persistence per user

- **Předpoklad:** Přihlášený uživatel A.
- **Kroky:**
  1. V přehledu VP klikni **Sloupce** → skryj 2 sloupce, změň pořadí, nastav sort.
  2. Obnov stránku (F5).
  3. Přihlas se jako uživatel B, otevři stejný přehled.
- **Očekávaný výsledek:**
  - Uživatel A po F5 vidí stejnou konfiguraci sloupců + sort.
  - Uživatel B vidí **výchozí** konfiguraci (layouty jsou per-user).
  - Po odhlášení A → přihlášení A znovu: konfigurace zůstává.

### 10.2 Layout napříč všemi moduly

- **Kroky:** Pro každý z: Zakázky, Výkresy, VP, Sklad výrobků, Sklad materiálu, Výkazy práce, Portfolio, Knihovny (Employee / Workplace / Material) → upravit 1 sloupec + sort → refresh.
- **Očekávaný výsledek:** Persistence funguje ve všech.

### 10.3 Drawing / Revision sloupce (regresní bod)

- **Předpoklad:** Výkresy se sloupci `drawing_no`, `revision`.
- **Kroky:**
  1. Otevři Výkresy.
  2. Ujisti se, že sloupce **Výkres** a **Revize** jsou viditelné.
  3. Filtruj, řaď.
- **Očekávaný výsledek:**
  - `drawing_no` i `revision` se korektně plní (nejsou prázdné, pokud jsou v DB).
  - Search cílí i na výkres a revizi.

### 10.4 Universal search — haystack pokrytí

- **Kroky:** V přehledech napiš postupně:
  - část GPN,
  - část názvu,
  - část výkresu,
  - revizi,
  - číslo zakázky,
  - jméno zákazníka,
  - objednávku,
  - scan kód.
- **Očekávaný výsledek:**
  - Search najde řádky obsahující dané hodnoty ve všech relevantních sloupcích (haystack pokrývá i skrytá data).
  - Není case-sensitive; diakritika ignorována (nebo je konzistentní napříč moduly).

### 10.5 Search placeholder vizuál

- **Kroky:** Najdi search ve všech přehledech.
- **Očekávaný výsledek:**
  - Stejný styl placeholderu (šedá #475569), stejná výška, stejná ikona/bez ikony.
  - Focus má konzistentní modrý border.

### 10.6 Reset layoutu

- **Kroky:** V **Sloupce** modal klikni **Resetovat** (pokud existuje).
- **Očekávaný výsledek:** Layout se vrátí na defaulty; persistence se přepíše.

---

## 11) Detail pages

### 11.1 Vizuální hierarchie — ProductionOrderDetailPage (baseline)

- **Kroky:** Viz sekce 2.2.

### 11.2 OrderCardPage — premium hierarchie

- **Předpoklad:** Zakázka s položkami.
- **Kroky:** Otevři kartu.
- **Očekávaný výsledek:**
  - Header: velký kód zakázky (28 px, primary), zákazník jako subtitle, drobný caption „Karta zakázky…", status badge Aktivní/Stornováno.
  - Sekce **Stav zakázky** (gradient karta): Zakázka / Zákazník / Objednávka / Datum.
  - **Provozní metriky** (KPI panel): Prodejní cena / Položek / Kusů / Stav barevně.
  - **Identifikace** (subtilní karta).
  - Níže tabulka položek, VP preview, restock preview beze změny funkcionality.

### 11.3 ProductStockDetailPage — premium hierarchie

- **Kroky:** Otevři detail skladové karty.
- **Očekávaný výsledek:** Stejný pattern + červené zvýraznění při pod min., KPI s počtem pohybů / posledním pohybem.

### 11.4 MaterialStockDetailPage — premium hierarchie

- **Kroky:** Otevři detail materiálové karty.
- **Očekávaný výsledek:** Header s kódem materiálu, název + rozměr, KPI s Pohyby / Posledním příjmem / Jednotkou.

### 11.5 PortfolioItemDetailPage — premium hierarchie

- **Kroky:** Otevři detail portfolio položky.
- **Očekávaný výsledek:**
  - Header: GPN + název + badge **Technologie připravena** / **Bez technologie**.
  - Sekce **Zdroj a portfolio**: Zákazník / Skupina / Logistický režim / Scan kód.
  - KPI: Technologie (zeleně/červeně) / Prodejní cena / Výkres / Revize.
  - Subtaby beze změny funkcionality.

### 11.6 Responsivita

- **Kroky:** Zmenšuj okno od 1600 px → 1280 → 1024 px.
- **Očekávaný výsledek:**
  - Header se nezalomí nesmyslně; badge zůstává vpravo.
  - KPI grid reflexivně mění počet sloupců.
  - Žádný horizontální scroll na hlavním kontejneru.

### 11.7 Hover efekty (global polish)

- **Kroky:** Najdi tabulky, KPI dlaždice, status badges, tlačítka VP/GPN links.
- **Očekávaný výsledek:**
  - Řádek tabulky: šedé pozadí + modrý levý border při hoveru.
  - KPI dlaždice: translateY(−3px) + hlubší stín.
  - Status badge: translateY(−1px) + stín.
  - Link `VP` / `GPN`: modrá #1D4ED8, hover tmavší modrá + underline.

### 11.8 Detail stránky — back button

- **Kroky:** Z detailu klikni „Zpět na…".
- **Očekávaný výsledek:** Vrátí na přehled se zachovaným filterem / searchem (pokud je implementováno; jinak default).

### 11.9 Otevřít v novém okně

- **Kroky:** V detailu klikni **Otevřít v novém okně**.
- **Očekávaný výsledek:** Nová záložka s URL obsahující deep-link parametry (např. `?view=orderCard&customerOrderId=123`), detail se načte stejně.

---

## 12) Login / actor / audit návaznosti

### 12.1 Přihlášení — role

- **Kroky:** Přihlas se účtem s rolí operator, zkus akce vyhrazené pro admin (storno VP, storno zakázky, úprava portfolio položky).
- **Očekávaný výsledek:** Tlačítka disabled nebo backend vrací 403; UI zobrazí hlášku „Nemáte oprávnění".

### 12.2 Actor v auditu

- **Předpoklad:** 2 uživatelé A (admin), B (sales).
- **Kroky:**
  1. A vytvoří zakázku.
  2. B přidá položku.
  3. A vytvoří VP.
- **Očekávaný výsledek:** V auditu / historii záznamu je u každé akce správný `actor`.

### 12.3 Actor v kiosk flow

- **Předpoklad:** Zaměstnanec E1 přihlášen čipem.
- **Kroky:** E1 spustí a dokončí operaci.
- **Očekávaný výsledek:** `work_reports.employee_id = E1`, `operation_events.actor` odpovídá.

### 12.4 Audit fulfillment rozhodnutí

- **Kroky:** Vytvoř VP s kombinovaným pokrytím (5.3).
- **Očekávaný výsledek:** V audit logu fulfillment je rozpad „sklad / WIP / výroba" s čísly a čase rozhodnutí.

### 12.5 Odhlášení a re-login

- **Kroky:** Logout → login pod stejným uživatelem.
- **Očekávaný výsledek:** Table layouty, preference a persistence se zachovají.

### 12.6 Session expirace

- **Kroky:** Nech session vypršet (pokud je TTL) nebo vymaž token v localStorage → pokus o akci.
- **Očekávaný výsledek:** UI přesměruje na login / zobrazí modal „Relace vypršela".

---

## 13) Cross-module regresní scénáře

> Tyto scénáře prochází několik modulů a ověřují, že integrace funguje end-to-end.

### 13.1 Full happy path: zakázka → VP → výroba → sklad → výdej

- **Kroky:**
  1. Vytvoř zakázku se 2 položkami.
  2. Vytvoř VP pro obě.
  3. V kiosku dokonči všechny operace včetně **Příjem sklad**.
  4. Ze skladové karty udělej výdej na „Expedice".
- **Očekávaný výsledek:**
  - Každý krok má audit záznam s actorem.
  - Skladová karta: přijato X, vydáno X, zbývá 0.
  - VP = Hotovo, zakázka = připraveno k expedici.
  - Metriky zakázky konzistentní s VP.

### 13.2 Storno řetězce: zakázka → VP → návratky

- **Kroky:**
  1. Zakázka s VP, který už spotřeboval část materiálu.
  2. Stornuj VP.
  3. Stornuj zakázku.
- **Očekávaný výsledek:**
  - Nespotřebovaný materiál se vrátil na sklad.
  - Vše má správný audit trail.
  - Přehledy s filterem „Stornované" obsahují oba záznamy.

### 13.3 Oprava chybného výkazu bez ztráty integrity

- **Kroky:**
  1. Vytvoř výkaz s chybným časem (VP se tím označí HOTOVO).
  2. Smaž výkaz → VP se re-otevře (8.3).
  3. Vytvoř nový, správný výkaz.
- **Očekávaný výsledek:**
  - Finální metriky VP odpovídají správnému výkazu (ne součtu obou).
  - Žádné „dangling" operation_events.

### 13.4 Dva uživatelé paralelně na stejném VP

- **Kroky:**
  1. User A otevře detail VP v prohlížeči X.
  2. User B otevře stejný VP v prohlížeči Y a dokončí operaci.
  3. User A klikne „Regenerovat z TP".
- **Očekávaný výsledek:**
  - A dostane informaci, že stav se změnil (buď refresh banner, nebo regenerace odmítnuta z důvodu „na operacích je reportovaný čas").
  - Žádná ztráta dat.

---

## 14) Post-pass smoke test (10 minut)

> Nejrychlejší průchod pro ověření, že nic zásadního není rozbité:

- [ ] Login funguje (admin + operator).
- [ ] Zakázky — přehled se načte, KPI jsou barevné, search filtruje.
- [ ] VP — přehled se načte, KPI jsou barevné, klik na VP otevře detail s novou hierarchií.
- [ ] Sklad výrobků — přehled + detail karty se načtou.
- [ ] Sklad materiálu — přehled + detail karty se načtou.
- [ ] Kiosk — login čipem, START / HOTOVO na jedné operaci.
- [ ] Výkazy — ruční výkaz se uloží.
- [ ] Planner — plán na dnešek funguje.
- [ ] Hover efekty tabulek funkční (modrý levý border).
- [ ] Žádné `NaN` / `undefined` / `Error` v UI.
- [ ] Dev console bez red error / warning spojeného s vlastním kódem.

---

## 15) Šablona pro záznam výsledku

```md
# Regresní pass — <YYYY-MM-DD>

Tester: <jméno>
Branch / commit: <hash>
DB snapshot: <soubor>

## Shrnutí
- Úspěšně prošlo: X / Y
- Problémy (severity):
  - [critical] …
  - [major] …
  - [minor] …

## Detail
(odškrtkaný checklist + poznámky)

## Doporučení k další iteraci
- …
```

---

## Zvláštní regresní body (kumulativně)

Tyto body byly dříve problematické a **musí** projít v každém regresním passu:

1. **Stock receipt na správnou kartu** (3.4) — navyšuje se karta pro konkrétní `portfolio_item_id`.
2. **Rollback po smazání výkazu** (8.3) — operace se re-otevře + metriky klesnou.
3. **Ruční completion** (8.4) — nahrazuje HOTOVO z kiosku, odblokuje navazující operace.
4. **Planner same-day scheduling** (6.1) — plán na dnešek skutečně dneskem je.
5. **Drawing / revision sloupce** (10.3) — viditelné, plní se z DB, search je najde.
6. **Table layout persistence** (10.1, 10.2) — per-user, přežije refresh i re-login.
7. **Universal search** (10.4) — pokrývá GPN / název / výkres / revizi / zakázku / zákazníka / objednávku / scan kód.

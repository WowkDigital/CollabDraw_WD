# Raport: Analiza i Naprawa Mechanizmu Undo/Redo (Cofnij/Ponów)

Ten dokument zawiera podsumowanie problemów technicznych związanych z mechanizmem Cofnij/Ponów w aplikacji **CoDraw** oraz opis wprowadzonych poprawek i potencjalnych przyczyn, dla których zmiany mogą nie być od razu widoczne w przeglądarce.

---

## 1. Zidentyfikowane Problemy Techniczne

Przed wprowadzeniem poprawek mechanizm Undo/Redo w ogóle nie działał z następujących powodów:

1. **Ignorowanie pochodzenia transakcji (Tracked Origins):**
   W pliku `js/sync.js` manager `Y.UndoManager` był zainicjalizowany w następujący sposób:
   ```javascript
   this.undoManager = new Y.UndoManager([this.yLayers, this.yLayerOrder], {
     trackedOrigins: new Set([null, undefined])
   });
   ```
   Oznaczało to, że Yjs rejestrował na stosie do cofnięcia wyłącznie transakcje bez określonego pochodzenia (`null` lub `undefined`). Jednak w kodzie aplikacji wszystkie rysunki i edycje były wykonywane w transakcjach oznaczonych etykietami `'canvas-edit'` (tworzenie kształtów, warstw itp.) oraz `'drawing'` (ciągłe dodawanie punktów w locie). W rezultacie stos Undo/Redo pozostawał pusty.

2. **Brak renderowania przywróconych obiektów:**
   Podczas cofania/ponawiania usunięcia warstwy, warstwa była dodawana ponownie do dokumentu Yjs, ale w pliku `js/ui.js` zdarzenie `'add'` w `onRemoteLayerChange` wywoływało jedynie:
   ```javascript
   this.canvas.addLayer(layerId, layerData.name, layerData.visible);
   ```
   To tworzyło pustą warstwę w Konva, ale nie renderowało kształtów, które znajdowały się wewnątrz niej w Yjs.

3. **Brak ponownej rejestracji obserwatorów (Observers):**
   Gdy warstwa była przywracana, obserwatory punktów dla istniejących linii nie były ponownie uruchamiane. Przez to zmiany w punktach nie synchronizowały się po przywróceniu warstwy.

---

## 2. Wprowadzone Poprawki (Co Zostało Zrobione)

Zaimplementowano następujące zmiany w kodzie projektu:

1. **Dodanie śledzenia pochodzenia edycji:**
   W [js/sync.js](file:///c:/Users/wowkd/Desktop/Antigraviti%20Condes/Drawing_WD/js/sync.js) zmodyfikowano `Y.UndoManager`, dodając `'canvas-edit'` do śledzonych źródeł:
   ```javascript
   this.undoManager = new Y.UndoManager([this.yLayers, this.yLayerOrder], {
     trackedOrigins: new Set([null, undefined, 'canvas-edit'])
   });
   ```
   *Uwaga:* Celowo **nie** dodano etykiety `'drawing'`. Dzięki temu pojedyncze ruchy myszką (dodawanie poszczególnych pikseli linii) nie zapychają stosu cofania. Cofnięcie usuwa cały narysowany obiekt (linię/kształt) naraz, a ponowne wykonanie przywraca go w pełni wraz z punktami.

2. **Przywrócenie renderowania kształtów:**
   W [js/ui.js](file:///c:/Users/wowkd/Desktop/Antigraviti%20Condes/Drawing_WD/js/ui.js) w zdarzeniu dodawania warstwy dodano wywołanie synchronizacji rysunków:
   ```javascript
   if (type === 'add') {
     this.canvas.addLayer(layerId, layerData.name, layerData.visible);
     if (layerData.shapes) {
       this.canvas.reconcileRemoteLayerShapes(layerId, layerData.shapes);
     }
   }
   ```

3. **Przywrócenie nasłuchiwania punktów:**
   W [js/sync.js](file:///c:/Users/wowkd/Desktop/Antigraviti%20Condes/Drawing_WD/js/sync.js) w sekcji dodawania nowej warstwy w `observeDeep` dodano automatyczną rejestrację nasłuchiwania punktów dla wszystkich zapisanych kształtów w przywracanej warstwie.

---

## 3. Dlaczego zmiany mogą nadal nie działać w przeglądarce? (Diagnostyka)

Jeśli po wdrożeniu poprawek zmiany nadal nie są widoczne, najprawdopodobniej przyczyną są:

### A. Agresywne Cache'owanie Service Workera (Główna Przyczyna)
Aplikacja rejestruje Service Workera w pliku `sw.js` (inicjalizowany w `js/app.js`). Z tego powodu przeglądarka mogła zapisać starą wersję plików `js/sync.js` oraz `js/ui.js` w pamięci podręcznej (Cache Storage).
* **Rozwiązanie:** 
  1. Otwórz narzędzia deweloperskie w przeglądarce (`F12` lub `Ctrl + Shift + I`).
  2. Przejdź do zakładki **Application** (lub **Application -> Service Workers**).
  3. Kliknij **Unregister** przy zarejestrowanym skrypcie `sw.js`.
  4. Przejdź do **Storage** i kliknij **Clear site data**.
  5. Odśwież stronę za pomocą `Ctrl + F5` (wymuszone odświeżenie bez pamięci podręcznej).

### B. Próba cofania rysunków z poprzednich sesji
`Y.UndoManager` rejestruje wyłącznie operacje wykonane lokalnie w **obecnej sesji przeglądarki**.
* Rysunki, które były już na ekranie po wejściu do pokoju (załadowane z bazy danych Firebase za pomocą `'firebase-initial'`), nie mogą być cofnięte przez użytkownika, ponieważ nie są częścią jego historii edycji w tej sesji.
* **Rozwiązanie:** Narysuj **nową** linię na tablicy, a następnie kliknij przycisk **Cofnij** (lub użyj `Ctrl + Z`). Ta nowa linia powinna natychmiast zniknąć.

### C. Blokowanie skrótów klawiszowych przez system/przeglądarkę
W niektórych środowiskach przeglądarkowych skróty takie jak `Ctrl+Z` lub `Ctrl+Y` mogą być przechwytywane przez przeglądarkę lub system operacyjny (np. na macOS za pomocą `Cmd+Z`).
* **Rozwiązanie:** Przetestuj działanie mechanizmu klikając bezpośrednio w **fizyczne przyciski ze strzałkami** w dolnym pasku menu (ikona strzałki w lewo to Cofnij, w prawo to Ponów). Jeśli przyciski działają, problem leży wyłącznie po stronie przechwytywania klawiszy przez przeglądarkę.

---

## 4. Rekomendowane Dalsze Kroki

Jeśli powyższe kroki nie przyniosą rezultatu, należy:
1. Zweryfikować w konsoli przeglądarki (zakładka *Console* w DevTools), czy nie pojawiają się żadne błędy JS podczas ładowania strony lub rysowania.
2. Dodać testowe logowanie zdarzeń do konsoli w `js/sync.js` w metodach `undo()` i `redo()` w celu sprawdzenia, czy wywołania z UI docierają do SyncManagera:
   ```javascript
   undo() {
     console.log('SyncManager: Wywołano undo');
     if (this.undoManager) {
       this.undoManager.undo();
     }
   }
   ```

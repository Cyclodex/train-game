<template>
  <div class="play-view" :class="{ debug: config.debug }">
    <MenuDrawer id="play" title="Menu">
      <button class="drawer-btn" @click="openPicker">
        <span>{{ modeIcon(currentModeId) }}</span><span>Game mode</span>
        <span class="drawer-btn__val">{{ game.mode.label }}</span>
      </button>
      <div class="drawer-divider"></div>
      <button class="drawer-btn" @click="pausePlayGame">
        <span>{{ paused ? "▶" : "⏸" }}</span>
        <span>{{ paused ? "Start" : "Pause" }}</span>
      </button>
      <button class="drawer-btn" @click="changeGlobalTimeScale">
        <span>⏩</span><span>Speed</span>
        <span class="drawer-btn__val">{{ globalTimeScale }}×</span>
      </button>
      <button class="drawer-btn" @click="cycleSwitchLock">
        <span>🔀</span><span>Switch lock</span>
        <span class="drawer-btn__val">{{ switchLockLabel }}</span>
      </button>
      <div class="drawer-slider">
        <span>🚗</span><span>Cars</span>
        <span class="drawer-btn__val">{{ carCountLabel }}</span>
        <input
          class="drawer-range"
          type="range"
          min="0"
          max="100"
          step="1"
          v-model.number="config.maxCars"
          @click.stop
        />
      </div>
      <div class="drawer-divider"></div>
      <button
        class="drawer-btn"
        :class="{ on: config.debug }"
        @click="switchDebugMode"
      >
        <span>🐞</span><span>Debug</span>
        <span class="drawer-btn__val">{{ config.debug ? "on" : "off" }}</span>
      </button>
      <button class="drawer-btn" @click="cycleTheme">
        <span>🎨</span><span>Theme</span>
        <span class="drawer-btn__val">{{ themeIcon }}</span>
      </button>
      <div class="drawer-divider"></div>
      <button v-if="canSave" class="drawer-btn" @click="openSaves">
        <span>💾</span><span>Saves</span>
      </button>
      <router-link class="drawer-btn" to="/editor">
        <span>✏️</span><span>Editor</span>
      </router-link>
      <router-link class="drawer-btn" to="/campaign">
        <span>🗺️</span><span>Campaign</span>
      </router-link>
      <router-link class="drawer-btn" to="/test">
        <span>🧪</span><span>Test world</span>
      </router-link>
    </MenuDrawer>
    <!-- NETWORK mode's score card: people carried, and how full the busiest
         platform is right now. It REPLACES the delivery card (one progress
         number per mode — HUD density, design doc §5.5). -->
    <div v-if="hud.passengers" class="score-card">
      <div class="score-head">
        <span class="score-icon">🧍</span>
        <span class="score-label">Passengers</span>
        <span class="score-count">
          <span class="score-now">{{ passengersCarried }}</span>
          <span class="score-sep">/</span>
          <span class="score-total">{{ passengerTarget }}</span>
          <span v-if="passengersCarried >= passengerTarget" class="score-check">✓</span>
        </span>
      </div>
      <div class="score-bar">
        <div class="score-bar-fill" :style="{ width: passengersPct + '%' }"></div>
        <span class="score-pct">{{ passengersPct }}%</span>
      </div>
      <div v-if="hud.timer && !dateLabel" class="score-timer">
        ⏱ {{ elapsedLabel }}
      </div>
      <div
        class="score-platform"
        :class="platformClass"
        title="Busiest platform — the run ends if one overflows"
      >
        🚉 {{ worstPlatform }}/{{ overcrowdLimit }} waiting
      </div>
      <div v-if="hud.stars && phase !== 'ready'" class="score-stars">
        <span
          v-for="s in stars"
          :key="s.id"
          class="star-pip"
          :class="{ 'star-pip--on': s.earned }"
          :title="s.label"
          >★</span
        >
      </div>
    </div>

    <!-- THE SERVICE PANEL (network mode): the whole player verb set of this
         mode in one card — which trains run which stops, and ordering another
         train when the service cannot keep up. Editing a line is a board
         gesture: click the stations, in the order you want them called at. -->
    <div v-if="hud.passengers" class="service-card">
      <div class="service-head">
        <span>🚉 Service</span>
        <button class="service-buy" title="Draw a new line" @click="newLine">
          + Line
        </button>
        <button
          class="service-buy"
          :disabled="!canBuyTrain"
          :title="buyTitle"
          @click="buyTrain"
        >
          + Train
        </button>
        <!-- A bus is planned exactly like a train (#90). It needs no depot:
             a bus lives on its line and appears at its first stop, so the
             only thing that gates the order is having a stop to appear at. -->
        <button
          v-if="hasBusStops"
          class="service-buy"
          :disabled="!canBuyBus"
          :title="buyBusTitle"
          @click="buyBus"
        >
          + Bus
        </button>
      </div>
      <!-- THE LINES. A line is a plan and stands on its own: you draw it
           before you own anything to run it, and it survives the last train
           leaving it. `0 trains` is a legitimate state, and deliberately
           reads as a warning rather than an error. -->
      <div v-for="l in game.lines" :key="l.id" class="service-line">
        <span class="service-livery" :style="{ background: l.colour }" />
        <span class="service-id">{{ l.name }}</span>
        <span class="service-stops">
          <template v-if="l.stops.length">
            <span
              v-for="(s, i) in l.stops"
              :key="s + i"
              class="service-stop"
              :title="`stop ${i + 1}: ${s}`"
              >{{ stationLabel(s) }}</span
            >
          </template>
          <span v-else class="service-idle">no stops yet</span>
        </span>
        <!-- What RUNS it. A line does not care what serves it, so this counts
             trains and buses together and "nothing" means neither. -->
        <span
          class="service-runners"
          :class="{ 'service-runners--none': l.trains.length + l.buses.length === 0 }"
          :title="
            l.trains.length + l.buses.length
              ? `${l.trains.length} train(s), ${l.buses.length} bus(es) running this line`
              : 'Nothing is running this line — people will wait for it'
          "
        >
          <template v-if="l.trains.length">{{ l.trains.length }}🚆</template>
          <template v-if="l.buses.length">{{ l.buses.length }}🚌</template>
          <template v-if="l.trains.length + l.buses.length === 0">0</template>
        </span>
        <button
          class="service-edit"
          :class="{ 'service-edit--on': editingLineId === l.id }"
          @click="toggleEditLine(l.id)"
        >
          {{ editingLineId === l.id ? "Done" : "Edit" }}
        </button>
        <button
          class="service-retire"
          title="Delete this line (its trains keep running as stoppers)"
          @click="deleteLine(l.id)"
        >
          ✕
        </button>
      </div>
      <div v-for="t in serviceTrains" :key="t.id" class="service-line">
        <span class="service-livery" :style="{ background: t.color }" />
        <span class="service-id">
          {{ t.id }}
          <!-- Ordered but still in the shed: it leaves when the depot mouth
               clears, so the queue is visible instead of the button looking
               like it did nothing. -->
          <span v-if="t.queued" class="service-queued" title="Waiting in the shed">🏠</span>
          <span v-if="t.load" class="service-load" :title="`${t.load} aboard`">{{ t.load }}</span>
        </span>
        <!-- The stops as PLACES, not numbers: a line reads "A → C → D", and
             the one the train is heading for is lit. Hovering gives the tile
             for anyone debugging a board. -->
        <span class="service-stops">
          <template v-if="t.stops.length">
            <span
              v-for="(s, i) in t.stops"
              :key="s + i"
              class="service-stop"
              :class="{ 'service-stop--next': s === t.nextStop }"
              :title="`stop ${i + 1}: ${s}`"
              >{{ stationLabel(s) }}</span
            >
          </template>
          <span v-else class="service-idle">no line</span>
        </span>
        <!-- Which line this train runs. Assigning is the verb now: the plan
             exists on its own, and a train is put onto it. -->
        <select
          class="service-assign"
          :value="game.trainLines[t.id] ? lineIdOf(t.id) : ''"
          title="Put this train onto a line"
          @change="assignTrain(t.id, $event)"
        >
          <option value="">— no line —</option>
          <!-- Only lines a TRAIN can actually run: a rail line, or one still
               empty. Offering a bus line here would strand the train on stops
               it has no rails to reach. -->
          <option v-for="l in linesFor('rail')" :key="l.id" :value="l.id">
            {{ l.name }}
          </option>
        </select>
        <!-- Withdraw: the ORDERLY verb. The train drops its line and runs to
             the nearest depot, where it is stabled. Shift-click scraps it
             where it stands — the emergency, and deliberately awkward. -->
        <button
          class="service-retire"
          :class="{ 'service-retire--on': t.retiring }"
          :title="
            t.retiring
              ? 'Running to the depot to be stabled — shift-click to scrap it now'
              : 'Withdraw: run to the nearest depot and stable it (shift-click to scrap where it stands)'
          "
          @click="retireTrain(t.id, $event)"
        >
          {{ t.retiring ? "↩" : "✕" }}
        </button>
      </div>
      <!-- THE BUSES. Same row shape as a train: what it is, what it carries,
           which line it runs. It has no depot to be withdrawn to, so there is
           one removal verb rather than the train's two. -->
      <div v-for="b in game.busServices" :key="b.id" class="service-line">
        <span class="service-livery service-livery--bus">🚌</span>
        <span class="service-id">{{ b.id }}</span>
        <span class="service-stops">
          <span v-if="b.lineId" class="service-stop"
            >{{ busLineName(b) }} — {{ b.passengers }}/{{ b.seats }} aboard</span
          >
          <span v-else class="service-idle">no line</span>
        </span>
        <select
          class="service-assign"
          :value="b.lineId ?? ''"
          title="Put this bus onto a line"
          @change="assignBus(b.id, $event)"
        >
          <option value="">— no line —</option>
          <!-- The mirror of the train's list: bus lines and empty ones only. -->
          <option v-for="l in linesFor('road')" :key="l.id" :value="l.id">
            {{ l.name }}
          </option>
        </select>
        <button
          class="service-retire"
          title="Take this bus off the road"
          @click="game.removeBus(b.id)"
        >
          ✕
        </button>
      </div>
      <!-- The hint names what is CLICKABLE right now, which changes once the
           first stop fixes the line's kind: a rail line takes platforms, a bus
           line takes kerbs, and never both. -->
      <p v-if="editingLineId" class="service-hint">
        Click {{ pickHint }} on the board to build <b>{{ editingLineName }}</b> —
        click a stop again to remove it.
      </p>
    </div>

    <div
      v-if="!roadOnly && !hud.passengers"
      class="score-card"
      :class="{
        'score-card--pulse': pulsing,
        'score-card--complete': levelComplete,
      }"
    >
      <div class="score-head">
        <span class="score-icon">🚆</span>
        <span class="score-label">Deliveries</span>
        <span class="score-count">
          <span class="score-now">{{ delivered }}</span>
          <span class="score-sep">/</span>
          <span class="score-total">{{ totalTrains }}</span>
          <span v-if="levelComplete" class="score-check">✓</span>
        </span>
      </div>
      <div class="score-bar">
        <div class="score-bar-fill" :style="{ width: deliveredPct + '%' }"></div>
        <span class="score-pct">{{ deliveredPct }}%</span>
      </div>
      <!-- The stopwatch gives way to the calendar where there is one: M13 is
           explicitly "a calendar clock, NOT a stopwatch", and the two are the
           same elapsed seconds rendered twice — exactly the HUD density §5.5
           warns against. Boards with no calendar (every other mode, and every
           untuned Tycoon board) keep the timer unchanged. -->
      <div v-if="hud.timer && !dateLabel" class="score-timer">
        ⏱ {{ elapsedLabel }}
      </div>
      <!-- The whole money HUD off the board is this one line. The fares live on
           the board as pins over their trains; anything more and we are building
           TV2's chrome (design doc §5.5). -->
      <div v-if="hud.money" class="score-money" title="Balance">
        💰 {{ balanceLabel }}
      </div>
      <!-- The second clock (§1.3), and the whole of it: a date instead of a
           stopwatch, and what the railway costs to hold for a year. Keyed on
           the tax paid so the row flashes exactly once per levy — money leaving
           silently is the one thing a balance readout must not do. -->
      <div
        v-if="hud.money && dateLabel"
        :key="taxPaid"
        class="score-calendar"
        :class="{ 'score-calendar--broke': taxUnaffordable }"
        :title="calendarTitle"
      >
        📅 {{ dateLabel }}
        <span class="score-tax">🏛 {{ taxPerYearLabel }}/yr</span>
        <!-- The warning that keeps bankruptcy a decision rather than an
             ambush. Same job as the gridlock nudge: name the failure before it
             lands, and name the fix — which is DELIVERING, because fares are
             the income. Clearing surplus track is the second way out and it
             costs a fee, so it is only worth it with years left to save. -->
        <span v-if="taxUnaffordable" class="score-tax-warn">
          ⚠ can't pay next year — deliver, or clear surplus track
        </span>
      </div>
      <div v-if="hud.stars && phase !== 'ready'" class="score-stars">
        <span
          v-for="s in stars"
          :key="s.id"
          class="star-pip"
          :class="{ 'star-pip--on': s.earned }"
          :title="s.label"
          >★</span
        >
      </div>
      <transition name="score-banner">
        <div v-if="levelComplete" class="score-complete-banner">
          ★ Level Complete ★
        </div>
      </transition>
    </div>
    <!-- In-play building, Transport-Fever style: a slim handle flush with the
         bottom edge while you just watch, and the EDITOR'S dock (BuildDock)
         when you build — same three rows, same muscle memory, but carrying only
         the verbs the sim can charge and execute in play. Esc or ✕ puts the
         tools away again. -->
    <div v-if="canBuild" class="play-build">
      <!-- Undo is an ACTION, not a mode: it reverses the last PURCHASE (full
           refund, no fee) and only appears while there is one to take back —
           in both dock states, because the mistake is usually noticed after
           the tools are put down. While the dock is open it DOCKS (actions
           slot): nothing may stack above the dock, that is board a click can
           no longer reach. -->
      <button
        v-if="!dockOpen && canUndoBuild"
        class="build-toggle build-toggle--undo"
        data-testid="undo-build"
        :title="undoTitle"
        @click="undoBuild"
      >
        <span class="build-toggle__icon">↩︎</span>
        <span>Undo {{ undoLabel }}</span>
      </button>
      <button
        v-if="!dockOpen"
        class="build-handle"
        data-testid="build-toggle"
        :title="buildToggleTitle"
        @click="openDock"
      >
        <span class="build-handle__icon">🛠️</span>
        <span>Build</span>
        <span class="build-handle__chev">▴</span>
      </button>
      <BuildDock
        v-else
        compact
        closable
        :categories="playDockCategories"
        :cat="playCat"
        :tab="playTabId"
        :active-item-key="activeItemKey"
        :hint="playHint"
        :help="playHelp"
        :breadcrumb="playBreadcrumb"
        :has-options="false"
        @select-cat="onDockCat"
        @select-tab="onDockTab"
        @select-item="onDockItem"
        @close="closeDock"
      >
        <template #actions>
          <button
            v-if="canUndoBuild"
            class="dock-undo"
            data-testid="undo-build"
            :title="undoTitle"
            @click="undoBuild"
          >
            <span>↩︎</span>
            <span>Undo {{ undoLabel }}</span>
          </button>
        </template>
      </BuildDock>
    </div>
    <!-- The jam nudge. Collisions are impossible here by construction, so
         DEADLOCK is the failure this game actually has, and without a word it
         reads as the game having frozen. Not an overlay: the board stays live
         so the fix (flip a switch) is one click away. -->
    <div v-if="gridlocked" class="gridlock-nudge" data-testid="gridlock-nudge">
      <span class="gridlock-nudge__icon">{{ gridlockIcon }}</span>
      <span>{{ gridlockMessage }}</span>
    </div>
    <div class="world">
    <div
      ref="viewport"
      class="world-viewport"
      :class="{ 'world-viewport--panning': panning }"
      @pointerdown="onViewportPointerDown"
      @pointermove="onViewportPointerMove"
      @pointerup="onViewportPointerUp"
      @pointercancel="onViewportPointerUp"
      @wheel.prevent="onViewportWheel"
    >
    <CityPanel />
    <!-- Click a house or a walker: who they are, and why they travel the way
         they do. Renders nothing outside the citizen layer. -->
    <CitizenInspector
      :plot-id="inspectPlotId"
      :focus-id="inspectPersonId"
      :pinned="pinnedPersonId"
      @close="closeInspector"
      @pin="setPinned"
    />
    <div class="world-zoom" v-if="worldOverflows()">
      <button class="zoom-btn" title="Zoom out" @click.stop="zoomBy(1 / 1.25)">−</button>
      <button class="zoom-btn zoom-btn--fit" title="Fit the whole world" @click.stop="fitWorld()">
        {{ Math.round(camera.zoom * 100) }}%
      </button>
      <button class="zoom-btn" title="Zoom in" @click.stop="zoomBy(1.25)">+</button>
    </div>
    <div
      class="level"
      :style="{
        gridTemplateColumns: `repeat(${bounds.cols}, ${config.tileSize}px)`,
        width: config.tileSize * bounds.cols + 'px',
        transform: levelTransform,
        '--switch-scale': switchScale,
      }"
      @click="onBackgroundClick"
      @mouseup="onLevelPointerGone"
      @mouseleave="onLevelPointerGone"
    >
      <Train
        v-for="trainObject in trains"
        :key="trainObject.id"
        :train-object="trainObject"
      />
      <div
        v-for="cell in gridCells"
        :key="cell.key"
        class="level-tile"
        :data-coord="cell.key"
        :class="{
          'level-tile--build-glow': buildArmed && buildGlowId === cell.key,
          'level-tile--razeable': razeArmed && canRaze(cell.key),
          'level-tile--pickable': isPickable(cell.key),
        }"
        :style="{
          width: config.tileSize + 'px',
          height: config.tileSize + 'px',
        }"
        @click="onTileClicked(cell.key)"
      >
        <TileGround :coord-id="cell.key" />
        <!-- Driveways and pavements, above EVERY tile's ground patch so a
             neighbour's jittered patch cannot chew a notch out of them at the
             seam. See TileGround.vue. -->
        <TileGround :coord-id="cell.key" layer="paving" />
        <!-- Standing scenery on its own layer above every patch fill, so a
             canopy overhanging the seam isn't cut by the next tile. -->
        <TileGround :coord-id="cell.key" layer="scatter" />
        <TileGround :coord-id="cell.key" layer="markings" />
        <Tile
          v-if="cell.tile"
          :tile="cell.tile"
          :coord-id="cell.key"
          class="tile-component"
          :switch-interactive="switchesEnabled && !buildArmed && !razeArmed"
          :switches-visible="switchesEnabled"
        />
        <!-- The town's BUILDINGS, drawn above the walkers and the cars so a
             resident leaving their own front door passes behind the house
             instead of over its roof. See TileGround.vue. -->
        <TileGround :coord-id="cell.key" layer="structures" />
        <!-- Forest canopies overhanging a line, drawn ABOVE the trains so a
             train passes under the foliage. See TileGround.vue. -->
        <TileGround :coord-id="cell.key" layer="canopy" />
        <!-- In-play building: the editor's triangular edge hit-zones + ghost
             preview, driven by the same extracted routeDrawController. Mounted
             only while the Build toggle is armed, so normal play is untouched.
             z-index sits ABOVE rails but BELOW cars and fare pins, so a waiting
             train can still be dispatched mid-build. -->
        <svg
          v-if="buildArmed"
          class="build-overlay"
          :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
        >
          <path
            v-for="(d, i) in previewRails(cell.key)"
            :key="'pv' + i"
            :d="d"
            class="preview-rail"
            :class="{ 'preview-rail--refused': previewRefused }"
          />
          <!-- The four edge wedges, unchanged: every edge stays reachable,
               because growing a branch off an existing line (which is how Lake
               Valley's station junction gets bought back) starts on an interior
               edge, not an open end. -->
          <path
            v-for="p in wedgePorts(cell.key)"
            :key="'z' + p"
            :data-port="p"
            :d="zonePath(p)"
            class="zone"
            :class="{
              'zone--armed': isBuildArmed(cell.key, p),
              'zone--finish': isBuildFinish(cell.key, p),
            }"
            @mousedown.stop="onZoneDown(cell.key, p)"
            @mouseup.stop="onZoneUp(cell.key, p)"
            @click.stop="onZoneClick(cell.key, p)"
            @mouseenter="onZoneEnter(cell.key, p)"
            @mouseleave="onZoneLeave(cell.key, p)"
          />
          <!-- The fix for aiming at the end of a line: a big disc ON TOP of the
               wedges, centred exactly on the open end. Drawn last, so it takes
               the click from the tapering triangle underneath.
               Both tiles either side draw one at the SAME world point — each
               clipped to its own half — so together they form one disc spanning
               the boundary, and both halves arm the same open end. That is what
               makes overshooting onto the empty neighbour harmless. Only while
               idle: once a gesture owns the board the wedges pick direction. -->
          <path
            v-for="t in openEndTargets(cell.key)"
            :key="'oe' + t.port"
            class="zone zone--open"
            :data-port="t.port"
            :d="edgeBandPath(t.port)"
            :class="{ 'zone--armed': isBuildArmed(t.end.id, t.end.edge) }"
            @mousedown.stop="onZoneDown(t.end.id, t.end.edge)"
            @mouseup.stop="onZoneUp(t.end.id, t.end.edge)"
            @click.stop="onZoneClick(t.end.id, t.end.edge)"
            @mouseenter="onZoneEnter(t.end.id, t.end.edge)"
            @mouseleave="onZoneLeave(t.end.id, t.end.edge)"
          />
          <!-- The knob that says "a line ends here". Owner-drawn only, or the
               facing pair would stack two. Never takes a click itself. -->
          <circle
            v-for="p in ownOpenEnds(cell.key)"
            :key="'oek' + p"
            class="open-end"
            :cx="edgeMid(p).x"
            :cy="edgeMid(p).y"
            :r="config.tileSize * 0.1"
          />
        </svg>
      </div>
      <div
        v-for="car in roadCarsView"
        :key="car.id"
        :class="['road-car', `road-car--${car.part}`, { 'road-car--inspect': config.debug }]"
        :style="{
          background: carColor(car.id),
          width: `${car.widthPx}px`,
          transform: `translate(-50%, -50%) translate(${car.x}px, ${car.y}px) rotate(${car.angle}deg)`,
        }"
        @mouseenter="onCarEnter(car.id)"
        @mouseleave="onCarLeave()"
        @click.stop="onCarClick(car.id)"
      >
        <span v-if="car.part !== 'trailer'" class="road-car-glass"></span>
        <!-- A SERVICE VEHICLE'S LOAD, the same gauge a train wears (Train.vue).
             Only a bus running a line has one: an ordinary car is somebody's own
             journey, not a service with seats to sell. -->
        <span v-if="car.load" class="vehicle-load" :title="car.load.title">
          <span
            class="vehicle-load-fill"
            :style="{ width: car.load.pct + '%', background: car.load.colour }"
          />
        </span>
        <span
          v-if="config.debug && car.part !== 'trailer'"
          class="road-car-id"
          :style="{ transform: `translate(-50%, -50%) rotate(${-car.angle}deg)` }"
        >{{ car.id }}</span>
      </div>
      <!-- People on the pavement. Absolutely positioned like the road cars,
           so they are not grid ITEMS and cannot displace a tile (KNOWHOW →
           RENDER LAYOUT). Empty on every board without a citizen layer. -->
      <div
        v-for="p in pedestrians"
        :key="p.id"
        :class="['pedestrian', { 'pedestrian--waiting': p.waiting }]"
        :style="{ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }"
        @click.stop="onWalkerClick(p.id)"
      />
      <!-- The pin over a pinned person. Absolutely positioned like the cars and
           the walkers, so it is not a grid ITEM (KNOWHOW → RENDER LAYOUT). -->
      <PersonPin v-if="pinnedPersonId" :person-id="pinnedPersonId" :zoom="camera.zoom" />
      <CarRouteOverlay
        v-if="config.debug && carRoute"
        :segments="carRoute.segments"
        :color="carColor(carRoute.carId)"
      />
      <!-- Fare pins. Absolutely positioned, like the road cars — a direct child
           of `.level` that generates a box becomes a GRID ITEM and eats a tile
           cell (see KNOWHOW → RENDER LAYOUT). A pin over a waiting train is its
           dispatch button; over a held one it names what it is waiting for; over
           a running one it just counts down. -->
      <FarePin
        v-for="badge in fareBadges"
        :key="`fare-${badge.trainId}`"
        :badge="badge"
        @send="onFareClick(badge)"
      />
      <!-- Build cost tag: rides the hovered tile while the ghost route is up —
           Train Valley's live "-2000$" (M2). Absolutely positioned like the
           fare pins (a box-generating direct child of .level would become a
           grid ITEM and eat a tile cell — KNOWHOW → RENDER LAYOUT). -->
      <div
        v-if="buildCostTag"
        class="build-cost-tag"
        :class="{ 'build-cost-tag--refused': buildCostTag.refused }"
        data-testid="build-cost"
        :style="{
          transform: `translate(-50%, -50%) translate(${buildCostTag.x}px, ${buildCostTag.y}px)`,
        }"
      >
        {{ buildCostTag.label }}
      </div>
      <!-- The meadow theme's backdrop trees: one world overlay in the canopy
           band, above rails/trains/cars, so overlapping crowns read as foliage
           the traffic passes under. Absolutely positioned, so it is not a grid
           ITEM (KNOWHOW → RENDER LAYOUT). -->
      <BackdropTrees :cols="bounds.cols" :rows="bounds.rows" />
      <Crossing
        v-for="c in crossings"
        :key="`crossing-${c.key}`"
        :coord-id="c.key"
        :cell="c.cell"
      />
    </div>
    </div>
    </div>
    <div v-if="hud.startOverlay && phase === 'ready'" class="game-overlay">
      <div class="overlay-card">
        <h2 class="overlay-title">{{ game.mode.label }}</h2>
        <p class="overlay-desc">{{ game.mode.description }}</p>
        <div v-if="hud.stars && goals.length" class="overlay-goals">
          <h3 class="overlay-goals-title">Goals</h3>
          <GoalList :goals="goals" />
        </div>
        <p v-if="best" class="overlay-best">
          Best: {{ best.stars }}★ · {{ best.timeSec.toFixed(1) }}s
        </p>
        <button class="overlay-btn" @click="startPlaying">Start</button>
        <button class="overlay-btn overlay-btn--ghost" @click="openPicker">
          Change game mode
        </button>
      </div>
    </div>
    <div
      v-if="hud.endOverlay && (phase === 'won' || phase === 'lost') && !endDismissed"
      class="game-overlay"
    >
      <div class="overlay-card">
        <h2 class="overlay-title">
          {{ phase === "won" ? "You win!" : "Failed" }}
        </h2>
        <div v-if="phase === 'won' && hud.stars && goals.length" class="overlay-goals">
          <GoalList :goals="goals" :earned="earnedGoalIds" />
        </div>
        <p v-if="phase === 'won'" class="overlay-desc">
          {{ earnedStars }}/{{ stars.length }} stars · {{ elapsedLabel }}
        </p>
        <p v-else class="overlay-desc">{{ lostReason }}</p>
        <!-- On a campaign level, going ON is the primary action; Retry is for
             chasing the stars you missed and steps back to a ghost button. -->
        <button
          v-if="phase === 'won' && nextCampaignLevel"
          class="overlay-btn"
          @click="goNextLevel"
        >
          Next: {{ nextCampaignLevel.name }} →
        </button>
        <button
          class="overlay-btn"
          :class="{
            'overlay-btn--ghost': phase === 'won' && !!nextCampaignLevel,
          }"
          @click="retry"
        >
          Retry
        </button>
        <!-- Train Valley's ∞: the result screen must not be a trap. Without it
             the overlay covers the whole board for good, and a level that
             completes on its own (or one you simply want to keep playing with)
             leaves every switch and signal unclickable. -->
        <button class="overlay-btn overlay-btn--ghost" @click="keepPlaying">
          Keep playing
        </button>
        <button class="overlay-btn overlay-btn--ghost" @click="openPicker">
          Change game mode
        </button>
      </div>
    </div>
    <div v-if="pickerOpen" class="game-overlay" @click.self="closePicker">
      <div class="picker-card">
        <h2 class="overlay-title">Choose a game mode</h2>
        <div class="mode-grid">
          <button
            v-for="m in modes"
            :key="m.id"
            class="mode-card"
            :class="{
              'mode-card--active': m.id === currentModeId,
              'mode-card--unfit': !!modeFits[m.id],
            }"
            :disabled="!!modeFits[m.id]"
            @click="pickMode(m.id)"
          >
            <span class="mode-card__icon">{{ modeIcon(m.id) }}</span>
            <span class="mode-card__label">{{ m.label }}</span>
            <span class="mode-card__desc">{{ m.description }}</span>
            <!-- Why this mode can't run on the CURRENT board (#114): the card
                 stays visible so the roster reads complete, with the missing
                 requirement as the reason. -->
            <span v-if="modeFits[m.id]" class="mode-card__unfit">{{
              modeFits[m.id]
            }}</span>
            <span v-else-if="m.id === currentModeId" class="mode-card__badge"
              >Playing</span
            >
          </button>
        </div>
        <!-- Daily is a board source, not a ruleset (#113): today's generated
             board, the same for every player, run under the daily ruleset. A
             chip below the mode cards rather than a sixth card, because it
             answers "which board" while the cards answer "which rules". -->
        <button
          class="overlay-btn"
          :class="{ 'overlay-btn--ghost': !isDailyActive }"
          @click="pickDaily"
        >
          📅 Today's challenge{{ isDailyActive ? " — playing" : "" }}
        </button>
        <button class="overlay-btn overlay-btn--ghost" @click="closePicker">
          Close
        </button>
      </div>
    </div>
    <!-- The Spielstand overlay: named save slots for the RUNNING game — trains
         mid-leg, money, objective progress (saveStore.ts + game.captureSave).
         Loading navigates to ?save=<id>, which remounts this view against the
         save. The `autosave` slot is written on leave while a run is live. -->
    <div v-if="savesOpen" class="game-overlay" @click.self="closeSaves">
      <div class="picker-card saves-card">
        <h2 class="overlay-title">Saved games</h2>
        <div class="saves-new">
          <input
            v-model="saveName"
            class="saves-name"
            data-testid="save-name"
            placeholder="Name this save…"
            @keyup.enter="saveGame()"
          />
          <button class="overlay-btn" data-testid="save-now" @click="saveGame()">
            💾 Save
          </button>
        </div>
        <div v-if="saveSlots.length" class="saves-list">
          <div v-for="s in saveSlots" :key="s.id" class="saves-row">
            <span class="saves-info">
              <b>{{ s.name }}</b>
              <span class="saves-sub">
                {{ modeIcon(s.modeId) }} {{ savedAtLabel(s) }}
                <template v-if="!s.compatible"> · incompatible version</template>
              </span>
            </span>
            <button
              class="overlay-btn saves-act"
              :disabled="!s.compatible"
              :title="s.compatible ? 'Resume this save' : 'Saved by an older version'"
              @click="loadSlot(s.id)"
            >
              Load
            </button>
            <button
              class="overlay-btn overlay-btn--ghost saves-act"
              title="Overwrite this slot with the current game"
              @click="overwriteSlot(s.id)"
            >
              ↻
            </button>
            <button
              class="overlay-btn overlay-btn--ghost saves-act"
              title="Delete this save"
              @click="removeSlot(s.id)"
            >
              ✕
            </button>
          </div>
        </div>
        <p v-else class="overlay-desc">No saved games yet.</p>
        <button class="overlay-btn overlay-btn--ghost" @click="closeSaves">
          Close
        </button>
      </div>
    </div>
    <div
      v-if="config.debug"
      class="event-log"
      :class="{ 'event-log--min': logMinimized }"
    >
      <div class="event-log-header">
        <span class="event-log-title">Activity log</span>
        <button
          class="event-log-toggle"
          :title="logMinimized ? 'Expand' : 'Minimize'"
          @click="logMinimized = !logMinimized"
        >
          {{ logMinimized ? "+" : "–" }}
        </button>
      </div>
      <ul v-show="!logMinimized" class="event-log-list">
        <li v-if="recentLog.length === 0" class="event-log-empty">
          No events yet…
        </li>
        <li
          v-for="entry in recentLog"
          :key="entry.id"
          class="event-log-entry"
          :class="`log-${entry.kind}`"
        >
          <span class="log-time">{{ entry.time.toFixed(1) }}s</span>
          <span class="log-train" :style="{ color: trainColor(entry.trainId) }">
            {{ entry.trainId }}
          </span>
          <span class="log-text">{{ entry.text }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { markRaw } from "vue";
import {
  Component,
  Inject,
  Provide,
  Vue,
  Watch,
  toNative,
} from "vue-facing-decorator";
import {
  GameConfig,
  GAME_CONFIG_KEY,
  gameConfig,
  SwitchLockMode,
  setWorldTheme,
} from "@/gameConfig";
import { nextTheme, themeMeta } from "@/themes";
import { Coordinates, Position, TrainsDefinition, TrainStatus } from "@/types";
import {
  Level,
  Port,
  TileCell,
  isLevelCrossing,
  isRoadOnlyLevel,
  parseCoordId,
} from "@/tiles/model";
import { canBuildOn, needsBridge, needsTunnel } from "@/tiles/terrain";
import { railPathsFor } from "@/tiles/geometry";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { TRACK_COST_PER_TILE } from "@/sim/economy";
import { TERRAIN_BUILD_FACTOR } from "@/tiles/terrain";
import type { RouteOpts, RouteStep, OpenEnd } from "@/tiles/routePlanner";
import { buildTargetsAt, openEndPortsAt } from "@/tiles/openEnds";
import {
  createRouteDrawController,
  type RouteDrawController,
} from "@/routeDrawController";
import { createGame, FareBadge, Game, GameSave, RoadCar, TrainDef } from "@/game";
import { DEFAULT_LEVEL, DEFAULT_TRAFFIC, defaultTrains } from "@/levels/default";
import { takeCustomLevel } from "@/levelStore";
import {
  AUTOSAVE_ID,
  SaveMeta,
  deleteSave,
  getSave,
  listSaves,
  putSave,
  slotIdFor,
} from "@/saveStore";
import { modeById, MODES } from "@/modes/index";
import { dailyMode } from "@/modes/daily";
import { sandboxMode } from "@/modes/sandbox";
import { boardCapabilities } from "@/modes/compat";
import { GameMode, ModeSetup } from "@/modes/types";
import { passengerTargetOf, OVERCROWD_LIMIT } from "@/modes/network";
import { loadLastModeId, saveLastModeId } from "@/modes/lastMode";
import { scenarioById, SCENARIOS } from "@/levels/test/index";
import { loadBest, recordResult, BestResult } from "@/objectiveStore";
import { CampaignLevel, nextLevelAfter } from "@/campaign";
import Crossing from "@/components/Crossing.vue";
import FarePin from "@/components/FarePin.vue";
import CityPanel from "@/components/CityPanel.vue";
import CitizenInspector from "@/components/CitizenInspector.vue";
import PersonPin from "@/components/PersonPin.vue";
import GoalList from "@/components/GoalList.vue";
import MenuDrawer from "@/components/MenuDrawer.vue";
import BuildDock, { type BuildDockCategoryView } from "@/components/BuildDock.vue";
import { levelBounds } from "@/tiles/bounds";
import { CHROME_INSETS, type Camera, type Size } from "@/camera";
import { switchFanScale } from "@/tiles/switchFan";
import { createCameraController, type CameraController } from "@/cameraController";

// The four tile edges, for the build tool's triangular hit-zones (same order as
// the editor's).
const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// The in-play build dock's tool tree: the editor's BuildDock shape, carrying
// only the verbs the sim can charge and execute during play — routing track
// (game.buildRoute) and bulldozing it (game.bulldoze). New play verbs (roads,
// stations…) become new tabs/categories HERE, and which modes see which
// categories is a per-mode decision layered on `playDockCategories`; today
// every mode with `controls.build` gets the full (two-verb) set.
type PlayDockCat = "rail" | "raze";
const PLAY_DOCK: BuildDockCategoryView[] = [
  {
    id: "rail",
    icon: "🚆",
    label: "Rail",
    accent: "#e3a63e",
    shortcut: "",
    tabs: [
      {
        id: "track",
        label: "Track",
        items: [{ key: "connect", icon: "🛤️", label: "Track" }],
      },
    ],
  },
  {
    id: "raze",
    icon: "🧨",
    label: "Bulldozer",
    accent: "#e0705e",
    shortcut: "",
    tabs: [
      {
        id: "raze",
        label: "Bulldoze",
        items: [{ key: "raze", icon: "🧨", label: "Bulldoze" }],
      },
    ],
  },
];

function buildTrainDefs(trains: TrainsDefinition): TrainDef[] {
  return Object.values(trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    destinations: (t.routeDestinations ?? []).map(d => d.to),
    // In service on a line (network mode) — the sim routes it stop to stop.
    ...(t.line?.length ? { line: t.line } : {}),
    spawnAtSec: t.spawnAtSec,
  }));
}

// Hash history puts the route's query in location.hash, e.g.
// "#/play?mode=puzzle&board=objectives".
function hashParam(name: string): string | null {
  const hash = window.location.hash;
  const q = hash.indexOf("?");
  if (q === -1) return null;
  return new URLSearchParams(hash.slice(q + 1)).get(name);
}

// Modes that generate their own board (e.g. Daily) return a fully-populated
// ModeSetup from setup(); calling setup() here lets PlayView honour that board
// for rendering + createGame instead of the default/custom/board context.
// Other modes' setup() is called again inside createGame — safe because setup()
// is pure and cheap (no side effects, no DOM).
function resolveBoard(
  mode: ReturnType<typeof modeById>,
  fallbackLevel: Level,
  fallbackTrains: TrainsDefinition,
  fallbackLevelId: string
): { level: Level; trains: TrainsDefinition; levelId: string; setup: ModeSetup } {
  const trainDefs = buildTrainDefs(fallbackTrains);
  const setup = mode.setup({
    level: fallbackLevel,
    trains: trainDefs,
    levelId: fallbackLevelId,
  });
  // If the mode returned a different level (i.e. it generated its own board),
  // use that everywhere. Otherwise fall back to the view-resolved board.
  if (setup.level !== fallbackLevel) {
    // Reconstruct a TrainsDefinition from the TrainDef[] the mode produced.
    // The view only uses TrainsDefinition for `totalTrains` (key count) and
    // for @Provide(); the actual sim is driven from TrainDef[] in createGame.
    const genTrains: TrainsDefinition = {};
    for (const def of setup.trains) {
      genTrains[def.id] = {
        id: def.id,
        x: def.x,
        y: def.y,
        status: TrainStatus.LeavingDepot,
        type: def.type,
        wagons: def.wagonIds.map(wid => ({ id: wid, type: def.type })),
        routeDestinations: [],
        currentRouteDestination: 0,
      };
    }
    return { level: setup.level, trains: genTrains, levelId: setup.levelId, setup };
  }
  return { level: fallbackLevel, trains: fallbackTrains, levelId: fallbackLevelId, setup };
}

@Component({ components: { BuildDock, Crossing, FarePin, GoalList, MenuDrawer, CityPanel, CitizenInspector, PersonPin } })
class PlayView extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  speeds = [1, 2, 4];
  levelSizeY = 6;
  // Whether the debug activity-log panel is collapsed to just its header.
  logMinimized = false;

  // A saved game to resume, from `?save=<slotId>` (the Spielstand overlay's
  // Load button navigates here). It wins over `?board=`/custom outright: the
  // save carries its own level, roster, mode and colours, and mixing in the
  // URL's board would restore state onto a world it was never taken from.
  // Null when the slot is absent or from an incompatible save version.
  private pendingSave: GameSave | null = (() => {
    const id = hashParam("save");
    return id ? getSave(id) : null;
  })();

  // An optional named board from `?board=<scenarioId>` — lets any test-world
  // scenario be played as a real game (e.g. a small, deterministic puzzle).
  // Returns null unless the id matches a registered scenario.
  private board = (() => {
    if (this.pendingSave) return null;
    const id = hashParam("board");
    if (!id) return null;
    return SCENARIOS.some(s => s.id === id) ? scenarioById(id) : null;
  })();

  // Read per instance (not at module load) so a level built in the editor and
  // handed over right before navigation is picked up on this mount.
  private custom = this.board || this.pendingSave ? null : takeCustomLevel();

  // What the URL (or the persisted preference) ASKED for, before the fitness
  // guard below has its say. Kept separately because it — not the resolved
  // mode — is what gets persisted on mount (see `mounted`).
  private requestedModeId = hashParam("mode") ?? loadLastModeId();

  // The active mode. `?board=daily` wins outright: the daily board IS the daily
  // ruleset, so picking it overrides any ?mode= alongside it (`?mode=sandbox&
  // board=daily` runs the daily ruleset). Otherwise an explicit ?mode= wins,
  // then the mode the player last used (persisted), then the default. Daily is
  // a board source since #113, not a picker mode: `?board=daily` (the picker's
  // chip) and legacy `?mode=daily` links (old bookmarks, a persisted
  // last-mode) both run today's generated board under the daily ruleset —
  // resolveBoard promotes the board setup() generates, exactly as before.
  //
  // The URL guard (#114): a mode the board cannot carry — Network with no
  // stations, Citizens with no towns — would load a game that can never
  // engage, silently. Fall back to the board's own mode, then the default,
  // then Sandbox (which fits anything). Unfit picker cards are disabled, so
  // this only fires on hand-typed URLs and stale links.
  private mode = (() => {
    // A save resumes under the mode it was taken in — no fitness guard: the
    // pair ran together when it was saved, so it fits by construction.
    if (this.pendingSave) {
      const id = this.pendingSave.modeId;
      return id === dailyMode.id ? dailyMode : modeById(id);
    }
    const requested = this.requestedModeId;
    if (hashParam("board") === "daily" || requested === "daily") {
      return dailyMode;
    }
    const mode = modeById(requested);
    // Cheap exit BEFORE the capabilities are derived: deriving them walks every
    // tile, floods the towns and rolls a per-plot RNG, and a mode that declares
    // no requirements (Sandbox) can never be refused by it.
    if (!mode.fits) return mode;
    const level = this.board
      ? this.board.level
      : this.custom
        ? this.custom.level
        : DEFAULT_LEVEL;
    const trains = this.board
      ? this.board.trains
      : this.custom
        ? this.custom.trains
        : defaultTrains();
    const caps = boardCapabilities(level, buildTrainDefs(trains));
    if (mode.fits(caps) === null) return mode;
    const fallbacks = [
      this.board?.mode ?? (this.board?.modeId ? modeById(this.board.modeId) : null),
      modeById(null), // the roster default
    ];
    for (const candidate of fallbacks) {
      if (candidate && (!candidate.fits || candidate.fits(caps) === null)) {
        return candidate;
      }
    }
    return sandboxMode;
  })();

  // Resolve which board the view should use. Modes that generate their own board
  // (e.g. Daily) return a different level from setup(); resolveBoard detects this
  // and promotes the generated board so the renderer and sim agree.
  private _resolved = (() => {
    // Resuming a save: the save IS the board. The game gets the save's own
    // (cloned) level and roster; `resolveBoard` is bypassed because a
    // generating mode (Daily) must NOT generate a fresh board over a saved
    // one — mode.setup still runs inside createGame against these inputs.
    if (this.pendingSave) {
      const savedLevel = structuredClone(this.pendingSave.level);
      const savedDefs = structuredClone(this.pendingSave.trains);
      const levelId = this.pendingSave.levelId;
      const setup = this.mode.setup({
        level: savedLevel,
        trains: savedDefs,
        levelId,
      });
      // Daily's setup generates its own board; pin the SAVED one back over it
      // so the sim, the renderer and the restore all agree on one world.
      const genTrains: TrainsDefinition = {};
      for (const def of savedDefs) {
        genTrains[def.id] = {
          id: def.id,
          x: def.x,
          y: def.y,
          status: TrainStatus.LeavingDepot,
          type: def.type,
          wagons: def.wagonIds.map(wid => ({ id: wid, type: def.type })),
          routeDestinations: (def.destinations ?? []).map(to => ({ to })),
          currentRouteDestination: 0,
          ...(def.line?.length ? { line: [...def.line] } : {}),
          ...(def.spawnAtSec !== undefined ? { spawnAtSec: def.spawnAtSec } : {}),
        };
      }
      return {
        level: savedLevel,
        trains: genTrains,
        levelId,
        setup: { ...setup, level: savedLevel, trains: savedDefs, levelId },
      };
    }
    // CLONE the board before the game gets it. `this.board` is the scenario
    // registry's module-level singleton (and `this.custom` can be the editor's
    // live reactive level), while build-in-play writes through `applyEdits`
    // into whatever level object the game holds. Handing the singleton over
    // raw meant bought track was written INTO THE REGISTRY: browser Back /
    // re-entering the URL remounted onto the mutated board with a fresh
    // balance (free track), Retry's "pristine" snapshot was taken after the
    // mutation, and /test rendered the same corrupted object. A clone makes
    // the game's world private; the registry stays what the author wrote.
    const fallbackLevel = structuredClone(
      this.board ? this.board.level : this.custom ? this.custom.level : DEFAULT_LEVEL,
    );
    const fallbackTrains = structuredClone(
      this.board
        ? this.board.trains
        : this.custom
          ? this.custom.trains
          : defaultTrains(),
    );
    const fallbackLevelId = this.board
      ? `board:${this.board.id}`
      : this.custom
        ? "custom"
        : "default";
    return resolveBoard(this.mode, fallbackLevel, fallbackTrains, fallbackLevelId);
  })();

  @Provide() trains: TrainsDefinition = this._resolved.trains;
  @Provide() level: Level = this._resolved.level;

  private levelId = this._resolved.levelId;
  best: BestResult | null = null;

  @Provide("game") game: Game = markRaw(
    createGame(
      this._resolved.level,
      this._resolved.setup.trains,
      gameConfig.tileSize,
      this.mode,
      // A save resumes on its own colour seed, so anything still derived from
      // it (road spawns) replays the saved run's world, not today's setting.
      this.pendingSave?.colorSeed ?? gameConfig.colorSeed,
      // When the save pinned colours (it always does — bought trains carry
      // palette colours no seed reproduces), or the mode did (Daily's
      // deterministic assignment), honour them exactly.
      this.pendingSave?.colors ?? this._resolved.setup.colors,
      DEFAULT_TRAFFIC,
      this._resolved.levelId,
      // Live car cap from the menu setting, read each spawn attempt.
      () => gameConfig.maxCars
    )
  );

  mounted() {
    // Frame the board before the first paint the player sees: a world larger
    // than the screen would otherwise open on its top-left corner, which looks
    // like a broken level rather than a big one.
    this.$nextTick(() => this.fitWorld());
    window.addEventListener("resize", this.onWindowResize);
    // Build-tool keys: Esc finishes an open route, Space is the pan modifier
    // while build owns the left drag. Both no-op unless build is armed. The
    // closures are created HERE so they capture the live component (see the
    // note on handleBuildKeydown).
    this.boundKeydown = e => this.handleBuildKeydown(e);
    this.boundKeyup = e => this.handleBuildKeyup(e);
    window.addEventListener("keydown", this.boundKeydown);
    window.addEventListener("keyup", this.boundKeyup);
    // Remember the mode the player ASKED for, so a later plain /play reopens
    // it. The requested id, not the resolved one: when the fitness guard (#114)
    // downgrades an unfit mode×board pair, saving the fallback would silently
    // erase the preference — play Network on a station board, open plain /play
    // once, and Network would never reopen even on boards that carry it. Only
    // a KNOWN id is persisted, so a typo'd ?mode= does not become the memory.
    const asked = this.requestedModeId;
    const known = asked !== null && (asked === dailyMode.id || MODES.some(m => m.id === asked));
    saveLastModeId(known ? asked : this.mode.id);
    this.best = loadBest(this.levelId);
    this.game.start(); // start the rAF loop (rendering); objective stays Ready
    if (this.pendingSave) {
      // Resume: the save carries the whole moving state — trains mid-leg,
      // money, tracker phase, bus roster. Nothing else may run first: seeding
      // scenario bus lines or auto-starting the objective would double what
      // the save is about to restore.
      this.game.restoreSave(this.pendingSave);
    } else {
      // The bus lines this board was authored with (`?board=<scenario>`), each
      // with a bus on it — the same seeding /test does, so a board plays the way
      // it demonstrates. A train comes with the level; a bus lives on its line,
      // so it can only be placed once the line exists.
      for (const stops of this.board?.busLines ?? []) {
        this.game.buyBus(this.game.createLine(stops));
      }
      if (!this.game.mode.hud.startOverlay) this.game.startObjective();
    }
    // Test hook: expose the live game so e2e can read simulation state without
    // depending on Vue's internal instance shape.
    (window as unknown as { __game?: Game }).__game = this.game;
  }

  // Set when the player dismisses the result screen to stay on the board. Reset
  // on any fresh run, so the next result is shown again.
  endDismissed = false;

  keepPlaying() {
    this.endDismissed = true;
  }

  startPlaying() {
    this.endDismissed = false;
    this.game.startObjective();
  }

  retry() {
    this.endDismissed = false;
    this.game.reset();
    this.game.startObjective();
  }

  // The level after this one in the campaign, or null off the campaign / at its
  // end. Safe as a getter: pure over a module constant and a levelId that never
  // changes for the life of the view.
  get nextCampaignLevel(): CampaignLevel | null {
    return nextLevelAfter(this.levelId);
  }

  // The mode is NOT optional in the query. PlayView resolves the mode from the
  // hash or the last-used mode and ignores the scenario's own modeId, so a
  // campaign level opened without it would silently run under whatever mode the
  // player last chose. The router-view is keyed on the full path, so pushing a
  // new query remounts this view against the new board.
  goNextLevel() {
    const next = this.nextCampaignLevel;
    if (!next) return;
    this.$router.push({
      name: "play",
      query: { mode: next.modeId, board: next.id },
    });
  }

  // ---- Game-mode picker -------------------------------------------------
  // The card grid of game types. Opened from the menu drawer or the start
  // overlay; picking a card navigates to `#/play?mode=<id>`, which remounts the
  // view (router-view is keyed on the full path) so the chosen mode loads fresh.
  pickerOpen = false;
  modes: GameMode[] = MODES;

  get currentModeId(): string {
    return this.game.mode.id;
  }

  // One per mode the drawer can be showing — which is the picker roster PLUS
  // Daily: it is not a picker card (it is the "Today's challenge" chip), but it
  // IS a reachable active mode, and the drawer renders `modeIcon(currentModeId)`
  // beside its label. Drop the entry and playing today's challenge shows the
  // fallback 🚆 next to "Daily Challenge" while the chip still shows 📅.
  private modeIcons: Record<string, string> = {
    puzzle: "🧩",
    tycoon: "💰",
    network: "🚉",
    citizens: "🏙️",
    sandbox: "🏖️",
    daily: "📅",
  };
  modeIcon(id: string): string {
    return this.modeIcons[id] ?? "🚆";
  }

  openPicker() {
    this.pickerOpen = true;
  }
  closePicker() {
    this.pickerOpen = false;
  }
  // The board a pick will actually LAND on — which is normally the board on
  // screen, because pickMode carries `?board=` across. The exception is the
  // daily board: picking a ruleset there means LEAVING today's board, so
  // pickMode drops the param and the navigation lands on the custom/default
  // board instead. Judging fitness against the daily blob there made the picker
  // lie: a generated board almost always has a town, so Citizens showed
  // ENABLED, and clicking it landed on the town-less default where the URL
  // guard silently downgraded to Puzzle — the exact bait-and-switch #114 exists
  // to prevent.
  private get pickTargetBoard(): { level: Level; trains: TrainsDefinition } {
    if (hashParam("board") !== "daily") {
      return { level: this.level, trains: this.trains };
    }
    const custom = takeCustomLevel();
    return custom
      ? { level: custom.level, trains: custom.trains }
      : { level: DEFAULT_LEVEL, trains: defaultTrains() };
  }
  // Which modes fit the board a pick would land on, by reason (null = fits).
  // Drives the picker's disabled cards; recomputed per open via the resolved
  // level/roster.
  get modeFits(): Record<string, string | null> {
    const target = this.pickTargetBoard;
    const caps = boardCapabilities(target.level, buildTrainDefs(target.trains));
    const out: Record<string, string | null> = {};
    for (const m of this.modes) out[m.id] = m.fits?.(caps) ?? null;
    return out;
  }
  pickMode(id: string) {
    this.pickerOpen = false;
    if (id === this.currentModeId) return; // already playing this mode
    // Keep the board when switching rules over it (#114). Unfit pairs never
    // get here — their cards are disabled. board=daily is the chip's URL:
    // picking a mode there means leaving the daily board, so it is dropped.
    const board = hashParam("board");
    const query =
      board && board !== "daily" ? { mode: id, board } : { mode: id };
    this.$router.push({ name: "play", query });
  }
  // Today's generated board under the daily ruleset (#113): the picker's board
  // chip. The levelId is `daily:<date>`, so "already playing today's" is a
  // prefix check rather than a mode comparison.
  get isDailyActive(): boolean {
    return this.levelId.startsWith("daily:");
  }
  pickDaily() {
    this.pickerOpen = false;
    if (this.isDailyActive) return;
    this.$router.push({ name: "play", query: { board: "daily" } });
  }

  @Watch("phase")
  onPhase(now: string) {
    if (now === "won") {
      const earned = this.game.objective.stars.filter(s => s.earned).length;
      this.best = recordResult(this.levelId, {
        stars: earned,
        timeSec: this.game.objective.counters.elapsedSec,
      });
    }
  }

  get phase(): string {
    return this.game.objective.phase;
  }
  get hud() {
    return this.game.mode.hud;
  }
  get stars() {
    return this.game.objective.stars;
  }
  // The board's TARGETS, built once at setup and safe to read before the run
  // starts — unlike `stars`, whose earned flags are evaluated over zeroed
  // counters and so hold for most goals before anything has happened.
  get goals() {
    return this.game.goals;
  }
  // Which of them the finished run actually earned. Only the win card passes
  // this; the Ready card passes nothing, so it cannot light a star by accident.
  get earnedGoalIds(): string[] {
    return this.stars.filter(s => s.earned).map(s => s.id);
  }
  get elapsedLabel(): string {
    const t =
      this.game.objective.timeLeftSec ??
      this.game.objective.counters.elapsedSec;
    return t.toFixed(1) + "s";
  }
  get earnedStars(): number {
    return this.stars.filter(s => s.earned).length;
  }
  // The crossing-flow readout is gone with Crossing Keeper (#121): every
  // remaining mode declares `crossingGate: false`, so the worst-car-wait chip
  // and its amber→red ramp were unreachable markup. `game.roadFrame
  // .maxCarWaitSec` and the `maxCarWaitSec`/`carsDelivered`/`crossingIncidents`
  // counters in `sim/objectives.ts` are untouched — a future road-scoring mode
  // re-reads them and paints its own overlay.
  get lostReason(): string {
    return this.game.objective.lostReason ?? "";
  }

  // --- money (Tycoon) --------------------------------------------------------
  // The balance, and one fare pin per live train. Both are inert for every mode
  // that declares no economy: `hud.money` is false and `fareBadges` stays empty.
  get balanceLabel(): string {
    return this.game.money.balance.toLocaleString("en-US");
  }
  // The calendar row. Empty `dateLabel` = this board named no calendar, and the
  // row is not rendered at all — the pre-tax money HUD, unchanged.
  get dateLabel(): string {
    return this.game.money.dateLabel;
  }
  get taxPerYearLabel(): string {
    return "$" + this.game.money.taxPerYear.toLocaleString("en-US");
  }
  get taxPaid(): number {
    return this.game.money.taxPaid;
  }
  get taxUnaffordable(): boolean {
    return this.game.money.taxUnaffordable;
  }
  get calendarTitle(): string {
    return this.taxUnaffordable
      ? "Next year's upkeep is more than you have — deliver before the year turns, or clear track you don't need"
      : "The year, and this railway's annual upkeep";
  }
  get fareBadges(): FareBadge[] {
    return this.game.fareBadges;
  }
  onFareClick(badge: FareBadge): void {
    // A drag that ends over a pin still fires a click; ignore it, or panning the
    // board would dispatch whatever train the cursor happened to land on.
    if (this.panning) return;
    if (badge.waiting) this.game.dispatch(badge.trainId);
  }

  // ---- Save / load (Spielstand) -----------------------------------------
  // Named slots in localStorage (saveStore.ts). The overlay is the whole verb
  // set: save under a new name, overwrite a slot, load one (navigates to
  // `?save=<id>`, which remounts this view against the save), delete one.
  savesOpen = false;
  saveName = "";
  saveSlots: SaveMeta[] = [];

  // The citizen layer is not serialized (v1 — see the save/load spec), so a
  // citizens game offers no save UI rather than a save that lies.
  get canSave(): boolean {
    return !this.game.citizenStats.enabled;
  }

  openSaves() {
    this.saveSlots = listSaves();
    this.savesOpen = true;
  }
  closeSaves() {
    this.savesOpen = false;
  }

  private defaultSaveName(): string {
    return `${this.game.mode.label} · ${new Date().toLocaleString()}`;
  }

  saveGame() {
    if (!this.canSave) return;
    const name = this.saveName.trim() || this.defaultSaveName();
    putSave(slotIdFor(name), this.game.captureSave(name));
    this.saveName = "";
    this.saveSlots = listSaves();
  }

  overwriteSlot(id: string) {
    if (!this.canSave) return;
    const existing = this.saveSlots.find(s => s.id === id);
    putSave(id, this.game.captureSave(existing?.name ?? id));
    this.saveSlots = listSaves();
  }

  loadSlot(id: string) {
    this.savesOpen = false;
    // The nonce remounts the view even when the same slot is loaded twice in
    // a row — the router-view is keyed on the full path.
    this.$router.push({
      name: "play",
      query: { save: id, t: Date.now().toString() },
    });
  }

  removeSlot(id: string) {
    deleteSave(id);
    this.saveSlots = listSaves();
  }

  savedAtLabel(s: SaveMeta): string {
    return new Date(s.savedAt).toLocaleString();
  }

  beforeUnmount() {
    // Autosave on leave: a running game survives navigating away (the editor,
    // the picker, a board switch) without the player having thought about it.
    // Only while the objective is live — a Ready screen or a finished run is
    // not progress worth clobbering the autosave slot with.
    if (this.canSave && this.phase === "playing") {
      putSave(AUTOSAVE_ID, this.game.captureSave("Autosave"));
    }
    this.game.stop();
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("keydown", this.boundKeydown);
    window.removeEventListener("keyup", this.boundKeyup);
  }

  // Re-clamp on resize: a window that grew could otherwise leave the board
  // stranded against an edge with empty space beside it.
  onWindowResize(): void {
    this.cam.reclamp();
  }

  // The board's extents come from the LEVEL, not from a fixed board size, so a
  // world is as big as its content. `gameConfig.levelSizeX`/`levelSizeY` are only
  // the default canvas a brand-new board starts on.
  get bounds(): { cols: number; rows: number } {
    // Touch the game's edit counter so this computed invalidates when track is
    // laid mid-run. `game.applyEdits` writes through the RAW level object (the
    // simulation reads it live and must not pay for a Proxy on every traverse),
    // which Vue cannot observe — the counter is the notification. See
    // `applyEdits` in game.ts.
    void this.game.levelVersion.value;
    return levelBounds(this.level, {
      cols: this.config.levelSizeX,
      rows: this.levelSizeY,
    });
  }

  get gridCells(): { key: string; tile: Level[string] | null }[] {
    void this.game.levelVersion.value; // see `bounds` above
    const out: { key: string; tile: Level[string] | null }[] = [];
    const { cols, rows } = this.bounds;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const key = `${x},${y}`;
        out.push({ key, tile: this.level[key] ?? null });
      }
    }
    return out;
  }

  // --- Camera ---------------------------------------------------------------
  // A world bigger than the screen is panned and zoomed rather than shrunk: the
  // board renders at its natural 200px tile (every piece of road geometry is in
  // those px) and this moves a window over it. The wiring is shared with the test
  // stage — see cameraController.ts.
  // Built in `created()`, NOT as a field initialiser: a field initialiser runs
  // while vue-facing-decorator is collecting data off a throwaway instance, so
  // the closures below would capture THAT `this` — one whose injected `config` is
  // still undefined. The first render calls `overflows` → `worldSize()` and dies
  // on it. `created()` runs on the real instance, before the first render.
  //
  // markRaw: a plain controller in component state must not be deep-proxied
  // (CLAUDE.md). Its own `state` is `reactive()`, so the camera still drives
  // re-renders.
  private cam!: CameraController;

  // The in-play build gesture: the exact controller the editor uses (edge
  // press/drag one-shot, click chaining incl. the U-turn pending case, hover
  // ghost), pointed at `game.buildRoute` instead of the editor's per-cell
  // writer. Built in `created()` and markRaw'd for the same reasons as `cam`.
  private routeCtrl!: RouteDrawController;

  created() {
    this.cam = markRaw(
      createCameraController(
        () => this.worldSize,
        () => this.viewportSize(),
        // The board is full-bleed; the score card, drawer and dock float over
        // it. These keep the BOARD clear of them (see camera.ts).
        () => CHROME_INSETS,
      ),
    );
    this.routeCtrl = markRaw(
      createRouteDrawController({
        drawing: () => (this.buildArmed ? "rail" : null),
        planOpts: () => this.buildPlanOpts(),
        lay: steps => this.layBuild(steps),
      }),
    );
  }

  get camera(): Camera {
    return this.cam.state.camera;
  }
  get panning(): boolean {
    return this.cam.state.panning;
  }
  get levelTransform(): string {
    return this.cam.transform;
  }
  // Counter-scale for the junction switch fans, so a zoomed-out world does not
  // shrink them back to the unusable size the old widget had. See switchFan.ts.
  get switchScale(): number {
    return switchFanScale(this.camera.zoom);
  }
  // Also a method: it reads `viewportSize()`, which is not a reactive dependency.
  worldOverflows(): boolean {
    return this.cam.overflows;
  }

  get worldSize(): Size {
    const { cols, rows } = this.bounds;
    return { width: cols * this.config.tileSize, height: rows * this.config.tileSize };
  }

  // A METHOD, not a getter: vue-facing-decorator turns a class getter into a
  // CACHED computed, and `$refs` is not reactive — so as a getter this was
  // evaluated once during the first render (before mount, `$refs` still empty),
  // cached the window fallback, and never invalidated. The camera then clamped
  // against the whole window instead of the viewport, and the bottom of a big
  // world became unreachable by exactly the chrome's height.
  viewportSize(): Size {
    const el = this.$refs.viewport as HTMLElement | undefined;
    return el
      ? { width: el.clientWidth, height: el.clientHeight }
      : { width: window.innerWidth, height: window.innerHeight };
  }

  fitWorld(): void {
    this.cam.fit();
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }
  onViewportWheel(e: WheelEvent): void {
    this.cam.onWheel(e, this.$refs.viewport as HTMLElement | undefined);
  }
  onViewportPointerDown(e: PointerEvent): void {
    // Left drag pans — the gesture everyone already knows from a map, and the
    // only one available on a trackpad or a touchscreen. Middle drag pans too,
    // so the same muscle memory works here and in the editor (where left has to
    // stay with the drawing tools). A single finger reports button 0, so it pans
    // as well.
    //
    // …EXCEPT while the build tool is armed: then the left drag belongs to
    // drawing (edge → edge one-shot routes), exactly the editor's policy —
    // stealing it makes the board unbuildable (KNOWHOW → WORLD SIZE + CAMERA).
    // Pan stays on middle-drag or space+left, and left-pan returns the moment
    // build is disarmed.
    const pan =
      (e.button === 0 || e.button === 1) &&
      !(this.buildArmed && e.button === 0 && !this.spaceHeld);
    // EVERY pointer is handed over, even the ones that may not pan: the camera
    // has to see a second finger to recognise a pinch, and a pinch outranks the
    // build tool — no tool in this app takes two fingers. See cameraController.ts.
    this.cam.onPointerDown(e, { pan });
    if (this.cam.pinching) this.abandonPinchedDraw();
  }
  // Belt and braces, exactly as in EditorView: the first finger of a pinch may
  // have pressed an edge zone (the zone's handler runs before this one bubbles
  // up), and a pinch that lays a rail would be worse than no pinch. It cannot
  // happen today — the zones bind `@mousedown`/`@mouseup`, and a
  // `touch-action: none` surface fires no compatibility mouse events, so building
  // by touch does not work here yet either. This is what stops a pinch drawing
  // once they move to pointer events.
  abandonPinchedDraw(): void {
    if (this.buildArmed) this.routeCtrl.clearPress();
  }
  onViewportPointerMove(e: PointerEvent): void {
    this.cam.onPointerMove(e);
  }
  onViewportPointerUp(e: PointerEvent): void {
    this.cam.onPointerUp(e);
  }

  // --- building during play (Tycoon phase 2) ---------------------------------
  // One toggle arms the tool; while armed, every tile grows the editor's
  // triangular edge zones and the shared routeDrawController drives the
  // gesture. Committing goes through `game.buildRoute`: affordability gate →
  // `applyEdits` → spend, so a refused edit costs nothing.
  EDGES = EDGES;
  buildArmed = false;
  spaceHeld = false;
  // Set by layBuild when game.buildRoute refuses (unaffordable, or a train
  // moved onto a route tile between preview and click). The controller advances
  // its head AFTER lay() returns, so the abort must run after the gesture
  // handler finishes — see settleBuildGesture.
  private buildRefusedFlag = false;

  get canBuild(): boolean {
    return this.game.mode.controls.build;
  }

  get buildToggleTitle(): string {
    const how =
      "Click an edge, then click tiles to route track; drag edge-to-edge for a quick link; Esc finishes.";
    // Prices derived from the same table game.buildCostOf charges from, so the
    // hint can never drift from the bill.
    const price = (f: number) =>
      `$${Math.round(TRACK_COST_PER_TILE * f).toLocaleString("en-US")}`;
    return this.game.money.enabled
      ? `Build track — ${price(TERRAIN_BUILD_FACTOR.grass)} per tile, ` +
          `${price(TERRAIN_BUILD_FACTOR.forest)} through woods, ` +
          `${price(TERRAIN_BUILD_FACTOR.urban)} through town. ${how}`
      : `Build track. ${how}`;
  }

  toggleBuild(): void {
    if (!this.buildArmed) {
      // Both directions must disarm the other, or the exclusion is a half-rule:
      // this branch used to arm Build without clearing Bulldoze, so going
      // Bulldoze → Build left BOTH lit, with raze-hover highlights under live
      // build zones and a tile click meaning two different things.
      this.razeArmed = false;
      this.buildArmed = true;
      return;
    }
    // Disarm ABANDONS rather than finishes: finishing would lay (and charge
    // for) a terminus straight on the pending frontier tile that no cost tag
    // ever showed. The order is load-bearing — dropAnchors clears the head, so
    // the finishRoute after it cannot lay the pending tile, only forget it.
    this.routeCtrl.dropAnchors();
    this.routeCtrl.finishRoute();
    this.routeCtrl.state.hoverPort = null;
    this.buildArmed = false;
  }

  // --- bulldoze --------------------------------------------------------------
  // Armed separately from Build, and mutually exclusive with it: the two verbs
  // both claim the left click on a tile, so only one can own it at a time.
  razeArmed = false;

  get razeToggleTitle(): string {
    const how = "Click a piece of track to remove it.";
    return this.game.money.enabled
      ? `Bulldoze track — costs a demolition fee, and never pays back. ${how}`
      : `Bulldoze track. ${how}`;
  }

  // --- undo ------------------------------------------------------------------
  // Reverses the last PURCHASE, not the board: full money back, no fee. It is
  // the answer to a misdrag, and keeping it apart from Bulldoze is what lets
  // the demolition price be honest (see CLEARING_COST_PER_TILE).
  get canUndoBuild(): boolean {
    // Through the reactive ref, not the method: `game` is markRaw'd, and
    // dispatching clears the window without touching `levelVersion`, so there
    // would be nothing else to re-evaluate on.
    return this.game.undoable.value.pieces > 0 && this.game.canUndoBuild();
  }
  get undoLabel(): string {
    const v = this.game.undoable.value.value;
    return v > 0 ? `(+$${v.toLocaleString("en-US")})` : "";
  }
  get undoTitle(): string {
    return (
      "Take back the last track you bought — full price returned, no fee. " +
      "Available until you build again, bulldoze, or send a train."
    );
  }
  undoBuild(): void {
    this.game.undoBuild();
  }

  toggleRaze(): void {
    if (this.razeArmed) {
      this.razeArmed = false;
      return;
    }
    // Arming Bulldoze disarms Build through its own EXIT path (not by clearing
    // the flag), so a half-drawn route is abandoned rather than left pending
    // behind the other tool. toggleBuild clears `razeArmed` on the way in, so
    // set it after.
    if (this.buildArmed) this.toggleBuild();
    this.razeArmed = true;
  }

  // --- the play build dock (TF-style collapsed handle ⇄ the editor's dock) ---
  // Collapsed is the DEFAULT: a slim handle flush with the bottom edge, so a
  // player who only wants to watch (or a phone screen) gives up almost nothing.
  // Opening the dock always arms a tool — the dock exists to build, and an open
  // dock with no armed tool is a click that does nothing.
  dockOpen = false;
  playCat: PlayDockCat = "rail";

  get playDockCategories(): BuildDockCategoryView[] {
    return PLAY_DOCK;
  }
  get playTabId(): string {
    return this.playCat === "raze" ? "raze" : "track";
  }
  get activeItemKey(): string {
    return this.buildArmed ? "connect" : this.razeArmed ? "raze" : "";
  }
  get playHint(): string {
    return this.razeArmed
      ? "Click a piece of track to remove it."
      : "Click an edge, then click tiles to route track — Esc finishes.";
  }
  // The full pricing paragraphs already exist as the old buttons' tooltips;
  // behind the dock's ? they finally have a place a phone can reach.
  get playHelp(): string {
    return this.razeArmed ? this.razeToggleTitle : this.buildToggleTitle;
  }
  get playBreadcrumb(): string {
    return this.razeArmed ? "Bulldozer → Bulldoze" : "Rail → Track";
  }

  openDock(): void {
    this.dockOpen = true;
    this.armCat(this.playCat);
  }
  closeDock(): void {
    // Putting the tools away disarms through toggleBuild's EXIT path, so a
    // half-drawn route is abandoned (not silently laid and charged).
    if (this.buildArmed) this.toggleBuild();
    this.razeArmed = false;
    this.dockOpen = false;
  }
  onDockCat(id: string): void {
    this.playCat = id === "raze" ? "raze" : "rail";
    this.armCat(this.playCat);
  }
  onDockTab(): void {
    // One tab per category today — nothing to switch.
  }
  onDockItem(): void {
    // One item per tab today: re-arm the open category (a no-op while armed).
    this.armCat(this.playCat);
  }
  private armCat(cat: PlayDockCat): void {
    if (cat === "raze") {
      if (!this.razeArmed) this.toggleRaze();
    } else if (!this.buildArmed) {
      this.toggleBuild();
    }
  }

  // Clicking a tile while Bulldoze is armed. Refusals (a depot, or track a
  // train occupies or has reserved) are deliberately quiet on the board — the
  // tile simply does not go — because the honest signal is the one the player
  // can see: the train sitting on it.
  onTileRaze(tileId: string): void {
    if (!this.razeArmed || this.panning) return;
    this.game.bulldoze(tileId);
  }

  // --- the service: lines and rolling stock (network mode) -------------------
  // Which LINE the player is currently drawing, if any. While this is set, a
  // click on a station tile edits that line instead of doing whatever the board
  // would otherwise do. It is the line, not a train's copy of one: you draw the
  // plan first and buy something to run it after.
  editingLineId: string | null = null;

  get lineEditing(): boolean {
    return this.editingLineId !== null;
  }
  get editingLineName(): string {
    return this.game.lines.find(l => l.id === this.editingLineId)?.name ?? "";
  }
  get pickHint(): string {
    const kind = this.lineKindOf(this.editingLineId);
    if (kind === "rail") return "stations";
    if (kind === "road") return "bus stops";
    return this.hasBusStops ? "stations or bus stops" : "stations";
  }
  lineIdOf(trainId: string): string {
    return this.game.lines.find(l => l.trains.includes(trainId))?.id ?? "";
  }
  // The lines a vehicle of this kind can run: its own kind, plus any line still
  // empty — an empty line has no kind yet, and buying the vehicle first is a
  // perfectly ordinary order of doing things.
  linesFor(kind: "rail" | "road"): { id: string; name: string }[] {
    return this.game.lines.filter(l => {
      const k = this.lineKindOf(l.id);
      return k === null || k === kind;
    });
  }
  isStationTile(tileId: string): boolean {
    return this.level[tileId]?.role === "station";
  }
  isBusStopTile(tileId: string): boolean {
    return this.game.busStopTiles.includes(tileId);
  }
  // What KIND of vehicle can serve a stop: a platform is rail, a kerb is road.
  stopKindOf(tileId: string): "rail" | "road" | null {
    if (this.isStationTile(tileId)) return "rail";
    if (this.isBusStopTile(tileId)) return "road";
    return null;
  }
  // A LINE has a kind too — the kind of the stops on it — and an empty one has
  // none yet, so the first click decides. A line must not MIX the two: no train
  // can call at a kerb and no bus can call at a platform, so a mixed line is one
  // its own vehicle can never run (the bus simply never spawns, silently). The
  // intermodal journey is two lines meeting at a walk link (D5), not one line
  // pretending to be both.
  lineKindOf(lineId: string | null): "rail" | "road" | null {
    return this.game.lines.find(l => l.id === lineId)?.kind ?? null;
  }
  // A tile you may click right now to add to (or remove from) the line open in
  // the panel.
  isPickable(tileId: string): boolean {
    if (!this.lineEditing) return false;
    const kind = this.stopKindOf(tileId);
    if (!kind) return false;
    const lineKind = this.lineKindOf(this.editingLineId);
    return lineKind === null || lineKind === kind;
  }
  // The service, as the panel shows it: every train with its stops and the one
  // it is heading for right now.
  get serviceTrains(): {
    id: string;
    color: string;
    stops: string[];
    nextStop?: string;
    queued: boolean;
    retiring: boolean;
    // "3/16" for a passenger train, "" for anything with no seats.
    load: string;
  }[] {
    return Object.keys(this.game.trainColors)
      .filter(id => !this.game.removedTrains.includes(id))
      .sort()
      .map(id => ({
        id,
        color: this.game.trainColors[id],
        stops: this.game.trainLines[id] ?? [],
        // From the reactive mirrors, NOT the sim: the sim is markRaw, so a
        // getter reading it never re-runs and the panel freezes.
        nextStop: this.game.trainNextStops[id],
        queued: this.game.queuedTrains.includes(id),
        retiring: this.game.retiringTrains.includes(id),
        load: this.loadLabel(id),
      }));
  }
  // Ordering only needs a depot to exist. A busy one does not refuse the sale
  // — the train is built and queues in the shed, and rolls out when the mouth
  // clears (Transport Fever's rule: a full depot delays the departure, not the
  // purchase).
  get canBuyTrain(): boolean {
    // A bus line open in the panel: the train would be bought straight onto
    // stops it cannot reach, so the order is refused rather than silently
    // producing a train that never moves.
    if (this.lineKindOf(this.editingLineId) === "road") return false;
    return this.game.depotTiles.length > 0;
  }
  get buyTitle(): string {
    if (this.lineKindOf(this.editingLineId) === "road") {
      return "The line you are editing is a bus line — buy a bus for it";
    }
    return this.canBuyTrain
      ? "Order another train, in service on the line you are editing"
      : "This board has no depot to build a train in";
  }
  // A bus needs no depot: it lives on its line and appears at its first stop.
  // What it does need is somewhere to appear — a board with no bus stops has
  // no bus service to plan, so the button is not offered at all.
  get hasBusStops(): boolean {
    return this.game.busStopTiles.length > 0;
  }
  get canBuyBus(): boolean {
    // The mirror of canBuyTrain: a rail line open means the bus would be bought
    // onto platforms it cannot drive to.
    if (this.lineKindOf(this.editingLineId) === "rail") return false;
    return this.hasBusStops;
  }
  get buyBusTitle(): string {
    if (this.lineKindOf(this.editingLineId) === "rail") {
      return "The line you are editing is a rail line — buy a train for it";
    }
    return this.editingLineId
      ? "Order a bus, in service on the line you are editing"
      : "Order a bus — assign it to a line to put it to work";
  }
  buyBus(): void {
    // Bought onto the line being drawn, when one is: that is almost always why
    // you are buying. Otherwise it waits on the roster to be assigned.
    this.game.buyBus(this.editingLineId ?? undefined);
  }
  busLineName(b: { lineId?: string }): string {
    return this.game.lines.find(l => l.id === b.lineId)?.name ?? "";
  }
  // The same number the gauge on the board draws, for the panel row: a vehicle
  // is easier to compare in a list than to chase across the map.
  loadLabel(vehicleId: string): string {
    const at = this.game.vehicleLoads?.[vehicleId];
    return at && at.seats > 0 ? `${at.aboard}/${at.seats}` : "";
  }
  // The cars as the board draws them, each carrying its own load gauge (or none).
  // The gauge is attached HERE rather than looked up per binding in the
  // template: the markup needs it three times, and vue-tsc cannot narrow a
  // function call to non-null across three separate calls.
  get roadCarsView(): (RoadCar & {
    load: { pct: number; colour: string; title: string } | null;
  })[] {
    return this.roadCars.map(car => ({
      // The gauge belongs to the VEHICLE and rides its leading unit: a semi is
      // drawn as a cab and a trailer, and two gauges on one lorry would be two
      // lorries as far as the eye is concerned.
      ...car,
      load: car.unit === 0 ? this.carLoad(car.vehicleId) : null,
    }));
  }
  // The load gauge for a road vehicle, or null for one that is not a service.
  // Keyed by the CAR's id, which is what a bus is drawn under — `vehicleLoads`
  // is written that way for exactly this lookup.
  carLoad(carId: string): { pct: number; colour: string; title: string } | null {
    const at = this.game.vehicleLoads?.[carId];
    if (!at || at.seats <= 0) return null;
    return {
      pct: Math.max(0, Math.min(100, Math.round((at.aboard / at.seats) * 100))),
      colour: at.colour || "#cbd5e1",
      title: `${at.aboard}/${at.seats} aboard`,
    };
  }
  assignBus(busId: string, ev: Event): void {
    const lineId = (ev.target as HTMLSelectElement).value;
    this.game.assignBus(busId, lineId === "" ? null : lineId);
  }
  buyTrain(): void {
    // A train bought while a line is open goes straight onto it — the common
    // case, since the reason you are buying is usually that line.
    const stops = this.editingLineId
      ? (this.game.lines.find(l => l.id === this.editingLineId)?.stops ?? [])
      : [];
    // Prefer a depot that is free right now, so an order that CAN leave at
    // once does; otherwise it joins the queue at the first one.
    const free = this.game.depotTiles.find(id => !this.game.occupied[id]);
    const def = this.game.buyTrain(stops, free);
    if (!def) return;
    // The board draws from the provided roster, so a bought train needs its
    // TrainObject here or it would run invisibly — the sim would move a train
    // with no sprite. (It did, until this was noticed.)
    this.trains[def.id] = {
      id: def.id,
      x: def.x,
      y: def.y,
      status: TrainStatus.LeavingDepot,
      type: def.type,
      wagons: def.wagonIds.map(id => ({ id, type: def.type })),
      ...(stops.length ? { line: [...stops] } : {}),
    };
    // Bought with no line open: there is nothing to draw, and the train waits
    // on the roster until it is assigned to one.
  }
  // Draw a new, empty line and start editing it. The plan comes first — you do
  // not need to own anything to plan a service.
  newLine(): void {
    const id = this.game.createLine([]);
    this.editingLineId = id;
    this.game.setLineOverlay({ lineId: id });
  }
  deleteLine(lineId: string): void {
    if (this.editingLineId === lineId) this.stopEditingLine();
    this.game.deleteLine(lineId);
  }
  assignTrain(trainId: string, ev: Event): void {
    const lineId = (ev.target as HTMLSelectElement).value;
    this.game.assignTrain(trainId, lineId === "" ? null : lineId);
  }
  // Trains ordered but still in the shed, waiting their turn on the metals.
  get queuedTrainIds(): string[] {
    return this.game.queuedTrains;
  }
  // Withdrawing a train. The DEFAULT is orderly: it drops its line and runs to
  // the nearest depot to be stabled, which is what a railway actually does and
  // takes as long as the journey takes. Shift-click is the emergency: gone
  // where it stands. Both are on one control because they are the same
  // intention at two urgencies, and the modifier keeps the drastic one out of
  // reach of an ordinary mis-click.
  retireTrain(trainId: string, ev: MouseEvent): void {
    if (ev.shiftKey) {
      this.game.scrapTrain(trainId);
      return;
    }
    if (!this.game.retireTrain(trainId)) {
      // No depot it can reach — the orderly verb has nowhere to send it, so
      // say so rather than appearing to do nothing.
      this.game.scrapTrain(trainId);
    }
  }

  stopEditingLine(): void {
    this.editingLineId = null;
    this.game.setLineOverlay(null);
  }
  stationLabel(tileId: string): string {
    return this.game.stationLabels[tileId] ?? tileId;
  }
  toggleEditLine(lineId: string): void {
    this.editingLineId = this.editingLineId === lineId ? null : lineId;
    // Draw (or clear) the line on the board: big call-order numbers on the
    // stops and the route along the metals.
    this.game.setLineOverlay(
      this.editingLineId ? { lineId: this.editingLineId } : null
    );
  }
  // A click on a station while a line is being drawn: APPEND it. Order is
  // click order, which is the order the trains on it will call — and the same
  // station may be clicked again later in the sequence (A, C, B, C is a real
  // service: out via C, back via C — the Transport-Fever shape). The one
  // exception is the LAST stop: clicking it again takes it back off, which is
  // both the undo gesture (drawing is append + take-back, so any mistake is
  // reversible from the end) and what keeps a doubled call (C, C) impossible
  // to draw. The transit layer normalises that case away anyway.
  editLineAt(tileId: string): void {
    const id = this.editingLineId;
    if (!id) return;
    const stops = [...(this.game.lines.find(l => l.id === id)?.stops ?? [])];
    if (stops.length && stops[stops.length - 1] === tileId) stops.pop();
    else stops.push(tileId);
    this.game.setLineStops(id, stops);
  }
  // One click handler for the board, so the armed tool decides what a click
  // means: bulldoze, edit a line, or nothing.
  onTileClicked(tileId: string): void {
    if (this.panning) return;
    if (this.isPickable(tileId)) {
      this.editLineAt(tileId);
      return;
    }
    // The inspector is LAST in the chain, and only when no tool is armed: a
    // click while building is a build, not a question about who lives there.
    if (!this.buildArmed && !this.razeArmed && this.game.citizenStats.enabled) {
      this.onPlotClick(tileId);
      return;
    }
    this.onTileRaze(tileId);
  }

  // --- the citizen inspector -------------------------------------------------
  // Click a plot to see who lives or works there; click a figure on the pavement
  // to jump straight to that person. Inert on every board without a citizen
  // layer, where `inspectPlot` returns null and the panel never renders.
  inspectPlotId: string | null = null;
  inspectPersonId: string | null = null;

  onPlotClick(coordId: string): void {
    this.inspectPersonId = null;
    this.inspectPlotId = this.inspectPlotId === coordId ? null : coordId;
  }

  onWalkerClick(walkerId: string): void {
    const id = this.game.personWalking(walkerId);
    if (!id) return;
    this.inspectPlotId = null;
    this.inspectPersonId = id;
  }

  // The pinned person: a big marker on the board that follows them, kept by the
  // VIEW rather than the panel so it survives the card being closed — you pin
  // somebody precisely so you can put the card away and watch them.
  pinnedPersonId: string | null = null;

  setPinned(id: string | null): void {
    this.pinnedPersonId = id;
  }

  closeInspector(): void {
    this.inspectPlotId = null;
    this.inspectPersonId = null;
  }

  // Whether a click here would actually remove something — drives the hover
  // affordance, so the player can see which tiles are theirs to take back
  // before clicking. Cheap: it reads the level, not the sim's reservations,
  // because those change every frame and the truth is enforced by `bulldoze`.
  canRaze(tileId: string): boolean {
    const cell = this.level[tileId];
    return !!cell && cell.role !== "depot" && cell.connections.length > 0;
  }

  get gridlocked(): boolean {
    return this.game.gridlock.stuck;
  }

  get gridlockIcon(): string {
    return this.game.gridlock.reason === "dead-end" ? "🛤️" : "🚦";
  }

  // Name the actual fix, which differs by cause: a deadlock frees on a switch,
  // a dead end needs rails. Telling a player to flip switches at a severed line
  // would send them hunting for a junction that cannot help.
  get gridlockMessage(): string {
    if (this.game.gridlock.reason === "dead-end") {
      return this.canBuild
        ? "A train has run out of track. Build the missing link — or bulldoze a wrong turn and try again."
        : "A train has run out of track: the line does not reach its station.";
    }
    // Deliberately does NOT offer "build a passing loop": building grows a line
    // from its OPEN END, and a deadlock happens on a network that is already
    // joined up — so there is usually nothing to build from. Promising a fix
    // the tool cannot perform is worse than naming the one that works.
    // Branching a siding off the side of a line needs real turnouts first
    // (today it would buy an unreachable crossing — see KNOWHOW).
    return "Trains are waiting on each other. Flip a switch to let one through.";
  }

  // Live plan options for the route controller: the current world bounds and
  // the passable gate. Terrain (water/rock/mountain) AND tiles a train occupies
  // or has reserved are unplannable, so the preview can never offer a route
  // `applyEdits` would then refuse for a stationary reason — only a train
  // moving in AFTER the preview can still refuse the commit.
  buildPlanOpts(): RouteOpts {
    const { cols, rows } = this.bounds;
    return {
      width: cols,
      height: rows,
      passable: (c: Coordinates) => {
        const id = getCoordinatesId(c);
        return canBuildOn(this.level[id]) && this.game.canEdit([id]);
      },
      // Water is crossable — on a bridge, at six tiles' worth of routing cost
      // and BRIDGE_BUILD_FACTOR of money. The occupancy gate still applies:
      // you cannot throw a span under a train any more than you can lay track
      // under one.
      bridgeable: (c: Coordinates) => {
        const id = getCoordinatesId(c);
        return needsBridge(this.level[id]) && this.game.canEdit([id]);
      },
      // Rock/mountain is borable — through a tunnel, at nine tiles' worth of
      // routing cost per tile of ridge and TUNNEL_BUILD_FACTOR of money. Same
      // occupancy gate as the span.
      tunnelable: (c: Coordinates) => {
        const id = getCoordinatesId(c);
        return needsTunnel(this.level[id]) && this.game.canEdit([id]);
      },
    };
  }

  private layBuild(steps: RouteStep[]): void {
    const res = this.game.buildRoute(steps);
    if (!res.ok) this.buildRefusedFlag = true;
  }

  // Runs after a controller entry point returns. On a refused lay the gesture
  // is abandoned outright — without this the controller's head points at track
  // that was never laid and the finish wedge floats over empty ground. The
  // dropAnchors→finishRoute order matters (see toggleBuild).
  private settleBuildGesture(): void {
    if (!this.buildRefusedFlag) return;
    this.buildRefusedFlag = false;
    this.routeCtrl.dropAnchors();
    this.routeCtrl.finishRoute();
  }

  onZoneDown(id: string, port: Port): void {
    this.routeCtrl.onZoneDown(id, port);
  }
  onZoneUp(id: string, port: Port): void {
    this.routeCtrl.onZoneUp(id, port);
    this.settleBuildGesture();
  }
  onZoneClick(id: string, port: Port): void {
    this.routeCtrl.onZoneClick(id, port);
    this.settleBuildGesture();
  }
  onZoneEnter(id: string, port: Port): void {
    this.routeCtrl.onZoneEnter(id, port);
  }
  onZoneLeave(id: string, port: Port): void {
    this.routeCtrl.onZoneLeave(id, port);
  }
  // A press released off the zones (grid mouseup / mouseleave) is abandoned,
  // matching the editor's grid-level clearPress wiring.
  onLevelPointerGone(): void {
    if (this.buildArmed) this.routeCtrl.clearPress();
  }

  isBuildArmed(id: string, port: Port): boolean {
    return this.routeCtrl.isArmed(id, port);
  }
  isBuildFinish(id: string, port: Port): boolean {
    return this.routeCtrl.isFinish(id, port);
  }
  get buildGlowId(): string | null {
    return this.routeCtrl.glowId;
  }

  // The triangular hit-zone for one edge: edge corners to the tile centre, so
  // every point of the tile maps to exactly one edge (the editor's shape).
  // Which edges of this tile are build targets right now, and how big a shape
  // each gets. Idle: only open ends (this tile's own, or the facing neighbour's,
  // which is what makes clicking either side of a line's end work). Routing: all
  // four, unchanged — the click then chooses a direction, not an anchor.
  // True only before a gesture has begun. The narrowing applies to the click
  // that STARTS a route, not to the ones that steer it: `routeStarted` alone is
  // the wrong test, because it only flips once the first segment is actually
  // laid — so the second click of every gesture would still see the narrowed
  // set and land on a delegating open-end target instead of the tile it aimed
  // at. `armed` (and a live drag) is what says "a gesture owns the board now".
  get buildIdle(): boolean {
    const s = this.routeCtrl.state;
    // Deliberately NOT gated on `pressFrom`. Doing so swapped the band for a
    // wedge on MOUSEDOWN, so mouseup landed on a different element — and a
    // browser fires `click` on the nearest common ancestor of the two, which
    // carries no handler. The click silently never reached the controller and
    // nothing armed. Whatever decides this must not change mid-press.
    return !s.armed && !s.routeStarted;
  }

  // The open ends a click on THIS tile should be able to grab: its own, plus a
  // facing neighbour's (so the empty side of a line's end works too).
  openEndTargets(id: string): { port: Port; end: OpenEnd }[] {
    if (!this.buildIdle) return [];
    void this.game.levelVersion.value; // ends move when track is laid or razed
    return buildTargetsAt(this.level, id);
  }

  // Ports still served by the tapering wedge. An open-end port is served by the
  // disc INSTEAD — one element per port, so the two never overlap and neither
  // can intercept the other's click. Interior edges keep their wedge, because
  // branching a line (Lake Valley's station junction) starts on one.
  wedgePorts(id: string): Port[] {
    const taken = new Set(this.openEndTargets(id).map(t => t.port));
    return taken.size === 0 ? EDGES : EDGES.filter(p => !taken.has(p));
  }

  // The open ends this tile OWNS (rail on this side), for drawing the knob.
  ownOpenEnds(id: string): Port[] {
    if (!this.buildIdle) return [];
    void this.game.levelVersion.value;
    return openEndPortsAt(this.level, id);
  }

  edgeMid(port: Port): { x: number; y: number } {
    const s = this.config.tileSize;
    const c = s / 2;
    if (port === Position.Top) return { x: c, y: 0 };
    if (port === Position.Right) return { x: s, y: c };
    if (port === Position.Bottom) return { x: c, y: s };
    return { x: 0, y: c };
  }

  // The pinwheel wedge, one per edge, dividing the tile between the four ports.
  // Fine while a gesture is steering (the click picks a direction), and hopeless
  // as a way to grab the END of a line — it tapers to a point at the tile centre
  // and at a fitted zoom (30px tiles) is a few pixels wide. That case is served
  // by the open-end disc drawn on top of these.
  // The open-end target: the half-tile band along that edge, used INSTEAD of the
  // wedge for that port. Both tiles either side of a line's end draw their own
  // band, so together they form one tile-wide strip centred on the boundary and
  // both halves arm the same end — overshooting onto the empty neighbour is
  // harmless. A whole half-tile where there was a triangle tapering to a point.
  edgeBandPath(port: Port): string {
    const s = this.config.tileSize;
    const c = s / 2;
    switch (port) {
      case Position.Top:
        return `M0 0 L${s} 0 L${s} ${c} L0 ${c} Z`;
      case Position.Right:
        return `M${c} 0 L${s} 0 L${s} ${s} L${c} ${s} Z`;
      case Position.Bottom:
        return `M0 ${c} L${s} ${c} L${s} ${s} L0 ${s} Z`;
      default:
        return `M0 0 L${c} 0 L${c} ${s} L0 ${s} Z`;
    }
  }

  zonePath(port: Port): string {
    const s = this.config.tileSize;
    const c = s / 2;
    switch (port) {
      case Position.Top:
        return `M0 0 L${s} 0 L${c} ${c} Z`;
      case Position.Right:
        return `M${s} 0 L${s} ${s} L${c} ${c} Z`;
      case Position.Bottom:
        return `M${s} ${s} L0 ${s} L${c} ${c} Z`;
      default:
        return `M0 ${s} L0 0 L${c} ${c} Z`;
    }
  }

  // The route the pointer is describing, priced. The controller decides WHICH
  // steps (anchor inclusion, U-turn trimming); the game prices only the NEW
  // pieces — the same filter the commit charges, so the tag never lies.
  get buildPreview(): { steps: RouteStep[]; cost: number; refused: boolean } | null {
    if (!this.buildArmed) return null;
    // The cost reads the RAW level (which connections already exist), which Vue
    // cannot observe — the edit counter is the notification (see `bounds`).
    void this.game.levelVersion.value;
    const steps = this.routeCtrl.previewSteps();
    if (steps.length === 0) return null;
    const cost = this.game.buildCostOf(steps);
    const refused = this.game.money.enabled && cost > this.game.money.balance;
    return { steps, cost, refused };
  }

  get previewRefused(): boolean {
    return this.buildPreview?.refused ?? false;
  }

  // Ghost rails per cell for the previewed route (the editor's rail-pair paint).
  get previewByCell(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const pv = this.buildPreview;
    if (!pv) return out;
    const size = this.config.tileSize;
    const off = this.config.railDistanceFromPath;
    for (const s of pv.steps) {
      (out[s.id] ??= []).push(...railPathsFor(s.a, s.b, size, off));
    }
    return out;
  }
  previewRails(id: string): string[] {
    return this.previewByCell[id] ?? [];
  }

  // The floating cost tag: Train Valley's live price on the pending route. On a
  // hover that plans NO route (blocked terrain in the way, or off the world) it
  // shows a refusal ✕ instead, so "can't build there" is visible rather than
  // just a missing ghost.
  get buildCostTag(): { x: number; y: number; label: string; refused: boolean } | null {
    if (!this.buildArmed) return null;
    const hover = this.routeCtrl.state.hoverPort;
    if (!hover) return null;
    const { x, y } = parseCoordId(hover.id);
    const px = (x + 0.5) * this.config.tileSize;
    const py = (y + 0.14) * this.config.tileSize;
    const pv = this.buildPreview;
    if (!pv) {
      const from = this.routeCtrl.state.pressFrom ?? this.routeCtrl.state.armed;
      // No route to show: only meaningful mid-gesture, over a different tile —
      // and never over the pending frontier tile, where a click FINISHES the
      // route rather than failing (its "no plan" is the U-turn trim, not a
      // refusal).
      if (!from || (from.id === hover.id && from.port === hover.port)) return null;
      if (hover.id === this.routeCtrl.state.pendingId) return null;
      return { x: px, y: py, label: "✕ no route", refused: true };
    }
    if (!this.game.money.enabled || pv.cost === 0) return null; // free — no tag
    return {
      x: px,
      y: py,
      label: `−$${pv.cost.toLocaleString("en-US")}`,
      refused: pv.refused,
    };
  }

  // Window key handlers. Bound in mounted() — NOT arrow-function fields: a
  // field initialiser's closure captures the data-collection `this` (the same
  // vue-facing-decorator trap as the camera), and here that bit for real — the
  // handler ran, read a forever-false `buildArmed` off the dead instance, and
  // Esc silently did nothing. `!:` fields keep the bound references stable so
  // removeEventListener matches.
  private boundKeydown!: (e: KeyboardEvent) => void;
  private boundKeyup!: (e: KeyboardEvent) => void;

  handleBuildKeydown(e: KeyboardEvent): void {
    // Ctrl/Cmd+Z is checked BEFORE the buildArmed gate: the whole point of undo
    // is that it is reachable after you have put the tool down and noticed the
    // mistake. Everything below it is build-mode-only.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (this.canUndoBuild) {
        e.preventDefault();
        this.undoBuild();
      }
      return;
    }
    if (!this.buildArmed) {
      // Bulldozing (or an idle dock): Esc puts the tools away entirely.
      if (e.key === "Escape" && this.dockOpen) this.closeDock();
      return;
    }
    if (e.key === "Escape") {
      // First Esc finishes the open route; an Esc with nothing pending closes
      // the dock — "Esc finishes, Esc again puts the tools away".
      const s = this.routeCtrl.state;
      const gestureOpen =
        s.routeStarted || s.armed !== null || s.pendingId !== null;
      this.routeCtrl.finishRoute();
      this.settleBuildGesture();
      if (!gestureOpen) this.closeDock();
    }
    if (e.code === "Space" && !this.spaceHeld) {
      this.spaceHeld = true;
      // Space is the pan modifier while building; keep the page still under it.
      e.preventDefault();
    }
  }
  handleBuildKeyup(e: KeyboardEvent): void {
    if (e.code === "Space") this.spaceHeld = false;
  }

  // Level-crossing cells (rail + road on the same tile) — overlaid with the
  // crossing furniture + cars. Derived from the shared `road?` seam.
  get crossings(): { key: string; cell: TileCell }[] {
    return Object.entries(this.level)
      .filter(([, cell]) => isLevelCrossing(cell))
      .map(([key, cell]) => ({ key, cell }));
  }

  // Live road-traffic cars, sampled to world positions by the game each frame.
  // People walking on the pavements (Citizens mode). A GETTER onto the
  // game's reactive array, exactly like roadCars — the array is written in
  // place by game.advance(), so Vue re-renders without a new binding.
  get pedestrians() {
    return this.game.pedestrians;
  }

  get roadCars() {
    return this.game.roadCars;
  }

  // The hovered/pinned car's route for the debug overlay (null when none).
  get carRoute() {
    return this.game.carRoute.value;
  }

  private carPalette = ["#d94c4c", "#3f7fd9", "#e0bc5c", "#e7e7e7", "#5fb37a"];
  // Stable colour per vehicle from the number in its base id (car0, car1, …). The
  // render id is `${carId}#${segment}`, so strip the segment suffix first — this
  // keeps a semi's cab and trailer in one livery.
  carColor(id: string): string {
    const base = id.split("#")[0];
    // A SERVICE VEHICLE WEARS ITS LINE'S COLOUR, like the train does: the bus on
    // the green line is green, and so are the people waiting for it and its row
    // in the panel. An ordinary car keeps a colour from the traffic palette —
    // it is somebody's own journey, not a service anyone is waiting for.
    const service = this.game.vehicleLoads?.[base];
    if (service?.colour) return service.colour;
    const n = parseInt(base.replace(/\D/g, ""), 10) || 0;
    return this.carPalette[n % this.carPalette.length];
  }

  // Debug route inspection: hover previews a car's route, click pins it (click
  // again or click empty space to unpin). No-op unless the debug overlay is on.
  // The render id is `${carId}#${unit}`; the sim wants the base car id.
  private baseCarId(id: string): string {
    return id.split("#")[0];
  }
  onCarEnter(id: string): void {
    if (this.config.debug) this.game.setHoveredCar(this.baseCarId(id));
  }
  onCarLeave(): void {
    if (this.config.debug) this.game.clearHoveredCar();
  }
  onCarClick(id: string): void {
    if (this.config.debug) this.game.togglePinnedCar(this.baseCarId(id));
  }
  onBackgroundClick(): void {
    // A drag that ends over the board still fires a click; ignore it, or panning
    // would clear the inspected car every time.
    if (this.panning) return;
    if (this.config.debug) this.game.clearRouteCar();
  }

  get paused(): boolean {
    return this.game.paused.value;
  }
  get globalTimeScale(): number {
    return this.game.speed.value;
  }
  get delivered(): number {
    return this.game.deliveries.value;
  }

  // True when the level has no depots and at least one road tile.
  get roadOnly(): boolean {
    return isRoadOnlyLevel(this.level);
  }

  // Total trains in the level — the delivery goal, since each train parks once
  // it reaches its matching depot (so "all trains home" completes the level).
  get totalTrains(): number {
    return Object.keys(this.trains).length;
  }

  get deliveredPct(): number {
    return this.totalTrains
      ? Math.round((this.delivered / this.totalTrains) * 100)
      : 0;
  }

  get levelComplete(): boolean {
    return this.totalTrains > 0 && this.delivered >= this.totalTrains;
  }

  // Whether the player may throw the points at all. `ModeControls.switches`
  // has always described this ("a mode only gates whether the view exposes
  // them") but nothing read it until the network mode needed it OFF: there the
  // train decides where it goes, so a switch the player can flip is a control
  // that fights the router. Every other mode passes true, exactly as before.
  get switchesEnabled(): boolean {
    return this.game.mode.controls.switches;
  }

  // --- passengers (network mode) ---------------------------------------------
  // What the network mode steers by: people carried against the board's target,
  // plus the fullest platform right now — the crowd IS the pressure, so it is
  // shown live rather than only in the stars.
  overcrowdLimit = OVERCROWD_LIMIT;
  get passengersCarried(): number {
    return this.game.objective.counters.passengersDelivered ?? 0;
  }
  get passengerTarget(): number {
    return passengerTargetOf(this.level);
  }
  get passengersPct(): number {
    return this.passengerTarget
      ? Math.min(100, Math.round((this.passengersCarried / this.passengerTarget) * 100))
      : 0;
  }
  get worstPlatform(): number {
    let worst = 0;
    for (const q of Object.values(this.game.stationQueues)) {
      if (q > worst) worst = q;
    }
    return worst;
  }
  // Amber as the platform fills, red as it nears the overflow that ends the run.
  get platformClass(): string {
    const ratio = this.worstPlatform / OVERCROWD_LIMIT;
    if (ratio >= 0.75) return "score-platform--critical";
    if (ratio >= 0.5) return "score-platform--busy";
    return "";
  }

  // Pop/glow the score card briefly whenever a new delivery lands.
  pulsing = false;
  private pulseTimer = 0;

  @Watch("delivered")
  onDelivered(now: number, prev: number) {
    if (now <= prev) return;
    // Restart the animation even on back-to-back deliveries: clear, then re-set
    // on the next frame so the CSS keyframes replay.
    this.pulsing = false;
    requestAnimationFrame(() => (this.pulsing = true));
    window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => (this.pulsing = false), 700);
  }

  // The most recent activity-log entries, newest first, for the debug panel.
  get recentLog() {
    return this.game.eventLog.slice(-60).reverse();
  }

  // Colour a train id in the log to match its sprite.
  trainColor(id: string): string {
    return this.game.trainColors[id] ?? "inherit";
  }

  // The current world theme's icon, shown compactly on the drawer button.
  get themeIcon(): string {
    return themeMeta(this.config.worldTheme).icon;
  }
  cycleTheme() {
    setWorldTheme(nextTheme(this.config.worldTheme));
  }

  switchDebugMode() {
    this.config.debug = !this.config.debug;
  }
  cycleSwitchLock() {
    const order: SwitchLockMode[] = ["off", "reserved", "occupied"];
    const next = (order.indexOf(this.config.switchLockMode) + 1) % order.length;
    this.config.switchLockMode = order[next];
  }
  get switchLockLabel(): string {
    switch (this.config.switchLockMode) {
      case "reserved":
        return "reserved";
      case "occupied":
        return "on train";
      default:
        return "off";
    }
  }
  // Road-traffic density %, set by the "Cars" slider (0–100). The game scales it
  // against the map's capacity and reads it live, so dragging re-targets density
  // immediately (100% packs the streets).
  get carCountLabel(): string {
    return this.config.maxCars === 0 ? "off" : `${this.config.maxCars}%`;
  }
  pausePlayGame() {
    this.game.paused.value = !this.game.paused.value;
  }
  changeGlobalTimeScale() {
    const currentIndex = this.speeds.indexOf(this.game.speed.value);
    this.game.speed.value =
      this.speeds[(currentIndex + 1) % this.speeds.length];
  }
}

export default toNative(PlayView);
</script>

<style lang="scss" scoped>
.level {
  display: grid;
  border: 1px solid green;
  // Positioned by the camera inside `.world-viewport`, not by flow: the camera
  // owns the offset (it centres a world smaller than the window itself), so a
  // `margin: 0 auto` here would fight it. `transform-origin` must be the corner
  // the camera's `scale() translate()` maths is expressed from.
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}
.level-tile {
  position: relative;
  flex: 0 0 auto;
  .debug & {
    outline: 1px solid red;
  }
}
.pedestrian {
  position: absolute;
  z-index: 6; // same band as the cars: on the pavement, beside the road
  top: 0;
  left: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  // Warm and pale so a figure reads against tarmac, pavement and grass
  // alike, with a dark ring so it never dissolves into the light stone.
  background: #f6e3c8;
  border: 1.5px solid rgba(40, 32, 24, 0.65);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  will-change: transform;
}

// Held at a kerb, waiting for the road to clear. Dimmed and ringed amber so a
// queue at a crossing reads as a queue rather than as people standing about.
.pedestrian--waiting {
  border-color: rgba(255, 176, 32, 0.95);
  opacity: 0.8;
}

.road-car {
  position: absolute;
  z-index: 6; // above the road surface and trains; booms (crossing) sit above
  top: 0;
  left: 0;
  // width is set inline per vehicle segment (car/truck/cab/trailer lengths).
  // 16px — sim/laneOffset.ts CAR_BODY_WIDTH_FRAC, keep in lockstep. Sized so
  // the width ratio to a 28px lane matches a real street (~0.57); at the old
  // 20px a car passing an informally parked one clipped through it.
  height: 16px;
  border-radius: 4px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.45);
  will-change: transform;
  overflow: hidden;
}
// Buses and lorries are genuinely wider than cars (LARGE_BODY_WIDTH_FRAC —
// 2.55m against 1.8m on a real street); the bike below stays its slim self.
.road-car--bus,
.road-car--truck,
.road-car--cab,
.road-car--trailer {
  height: 18px;
}
// In debug mode cars are clickable to inspect their route.
/* Debug: the car id pinned to the sprite (counter-rotated so it stays
   readable whatever way the car points). Identifies the cars the junction
   owner / hold chips talk about. */
.road-car-id {
  position: absolute;
  left: 50%;
  top: 50%;
  font-size: 8px;
  line-height: 1;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 3px;
  padding: 1px 2px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 7;
}
.road-car--inspect {
  cursor: pointer;
}
// A semi's cab: a touch darker and boxier than the trailer it pulls.
.road-car--cab {
  filter: brightness(0.82);
  border-radius: 4px 3px 3px 4px;
}
// A semi's trailer: a long boxy container, squarer corners, no windscreen.
.road-car--trailer {
  border-radius: 2px;
  filter: brightness(1.05);
}
.road-car-glass {
  position: absolute;
  top: 20%;
  bottom: 20%;
  left: 60%; // toward the front (local +x is the direction of travel)
  width: 26%;
  background: rgba(185, 222, 255, 0.9);
  border-radius: 2px;
}
/* The load gauge on a service vehicle. Same shape and reading as a train's
   (Train.vue) — one gauge for one meaning, whatever is carrying you. It rides
   with the body, so it needs no counter-rotation. */
.vehicle-load {
  position: absolute;
  left: 10%;
  top: 50%;
  width: 48%;
  height: 7px;
  transform: translateY(-50%);
  // Light track, dark rim — same reasoning as the train's gauge: the empty part
  // has to be visible against the vehicle's own paint, whatever colour that is.
  background: rgba(236, 242, 248, 0.85);
  border: 1px solid rgba(12, 16, 22, 0.75);
  border-radius: 3px;
  overflow: hidden;
  pointer-events: none;
}
.vehicle-load-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
}
// A rigid truck's cab is only the front of its longer body, so its windscreen is
// a small pane right at the nose rather than a wide window like a car's.
.road-car--truck .road-car-glass {
  left: 76%;
  width: 13%;
}
// A bus: a long, slightly taller coach. A row of side windows runs nearly the
// whole length (a repeating glass/pillar band), so it reads as a passenger bus
// rather than a cargo truck even before you notice it riding the bus lane.
.road-car--bus {
  height: 24px;
  border-radius: 6px;
  filter: brightness(1.08);
}
.road-car--bus .road-car-glass {
  top: 22%;
  bottom: 48%;
  left: 10%;
  width: 80%;
  border-radius: 2px;
  background: repeating-linear-gradient(
    90deg,
    rgba(185, 222, 255, 0.95) 0,
    rgba(185, 222, 255, 0.95) 7px,
    rgba(30, 44, 60, 0.55) 7px,
    rgba(30, 44, 60, 0.55) 10px
  );
}
// A bicycle: a true sliver of a vehicle — ~0.3× a car's 20px width, so the
// frame is THINNER than its rider. The glass span is repurposed as the RIDER:
// a dark head-dot amidships over the livery (the jersey), deliberately wider
// than the frame (overflow visible) — the dot is what keeps a velo readable
// and individually trackable at 6px. Livery-first, one dot, nothing else (the
// rolling-stock lesson at small sizes).
.road-car--bike {
  height: 6px;
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  overflow: visible; // the rider's head-dot overhangs the slim frame
}
.road-car--bike .road-car-glass {
  top: 50%;
  bottom: auto;
  left: 42%;
  width: 7px;
  height: 7px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: rgba(28, 24, 20, 0.85);
}
// A motorcycle: today's 8px capsule — the body the bike wore before it slimmed
// down. Behaviour-wise a fast, narrow car (any lane, overtakes), so it keeps
// the chunkier motor-vehicle silhouette with the same rider head-dot.
.road-car--motorcycle {
  height: 8px;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.road-car--motorcycle .road-car-glass {
  top: 50%;
  bottom: auto;
  left: 42%;
  width: 6px;
  height: 6px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: rgba(28, 24, 20, 0.85);
}
// The fare pin lives in `components/FarePin.vue` — markup and styles both, so the
// two views that draw it cannot drift apart.
// ---- the build tool (Tycoon phase 2) ----
// One floating toggle: the whole build HUD off the board. The cost lives on the
// ghost preview's tag, not here.
// Build and Bulldoze sit in one centred row. They used to be positioned
// individually, the second by a hand-guessed pixel offset from centre — which
// was too small for the wider Build label and overlapped it by 76px. Laying
// them out in a flex row makes the arrangement independent of either label's
// width, so nothing has to be re-guessed when the wording changes.
// The play build chrome: a column that stacks Undo above whichever build
// surface is showing — the collapsed handle or the opened dock. The wrapper
// hugs the bottom EDGE while collapsed (the handle is a tab growing out of the
// screen edge, TF's slim-bar manner) and lifts a step while the dock is open.
.play-build {
  position: fixed;
  z-index: 2000;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 24px);
  pointer-events: none; // wrapper transparent; children re-enable

  > * {
    pointer-events: auto;
  }
}
// Undo, docked (the actions slot): the same verb as the floating pill, shrunk
// to the dock's scale.
.dock-undo {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font: 700 12px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #cfe6d6;
  background: transparent;
  border: 1px solid rgba(95, 211, 154, 0.5);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: rgba(95, 211, 154, 0.16);
  }
}
// The collapsed state: one slim tab flush with the bottom edge. Deliberately
// quieter than the old floating pill — while you only watch, the chrome should
// cost as close to nothing as it can.
.build-handle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px 9px;
  font: 700 13px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #eef2f6;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.88),
    rgba(18, 22, 28, 0.88)
  );
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.35);
  cursor: pointer;

  &:hover {
    border-color: rgba(95, 211, 154, 0.55);
  }
}
.build-handle__icon {
  font-size: 15px;
  line-height: 1;
}
.build-handle__chev {
  font-size: 10px;
  color: #8fa3b3;
}
// The Undo pill keeps the old chrome's livery — it is the one control that
// survives from the pill row, and it must read the same in both dock states.
.build-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  font: 700 15px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #eef2f6;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.92),
    rgba(18, 22, 28, 0.92)
  );
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  cursor: pointer;

  &:hover {
    border-color: rgba(95, 211, 154, 0.55);
  }
}
// Undo is not a mode, so it never gets the armed treatment — it is a plain
// action that appears only while there is a purchase to take back.
.build-toggle--undo {
  color: #cfe6d6;
  border-color: rgba(95, 211, 154, 0.5);

  &:hover {
    background: rgba(95, 211, 154, 0.16);
  }
}
// Only tiles that would actually go light up, so the affordance never promises
// a removal the guard will refuse.
.level-tile--razeable {
  cursor: pointer;

  &:hover::after {
    content: "";
    position: absolute;
    inset: 6px;
    border: 2px dashed rgba(217, 102, 63, 0.9);
    border-radius: 10px;
    background: rgba(217, 102, 63, 0.16);
    pointer-events: none;
    z-index: 5;
  }
}
// The jam nudge: a strip under the score card, deliberately NOT an overlay —
// the fix is a click on the board behind it.
.gridlock-nudge {
  position: fixed;
  z-index: 2000;
  top: 96px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 10px 18px;
  font: 600 14px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #2a1a06;
  background: linear-gradient(90deg, #ffd88a, #f5b942);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  animation: gridlock-in 0.25s ease-out;
}
.gridlock-nudge__icon {
  font-size: 18px;
}
@keyframes gridlock-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-6px);
  }
}
.build-toggle__icon {
  font-size: 18px;
  line-height: 1;
}
// The edge hit-zone overlay, above every piece of board art the ghost route can
// cross — including the town's roofs (`.tile-structures`, z7), which at the old
// z5 covered a preview rail drawn through a plot. The fare pins stay above it,
// so a waiting train is still dispatchable mid-build.
.build-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 8;
}
// Edge hit-zones + wedge cues, matching the editor's look so the gesture reads
// as the same tool (both stylesheets are scoped, so the rules can't be shared).
.zone {
  fill: rgba(66, 184, 131, 0.05);
  stroke: none;
  cursor: pointer;
  transition: fill 0.08s;
  &:hover {
    fill: rgba(66, 184, 131, 0.28);
  }
}
.level-tile:hover .zone {
  stroke: rgba(44, 62, 80, 0.25);
  stroke-width: 1;
}
// An open-end target is the only zone on its tile, so it can afford to be
// obvious — and it needs to be, because before this the player was aiming at an
// invisible triangle tapering to a point.
.zone--open {
  fill: rgba(66, 184, 131, 0.14);

  &:hover {
    fill: rgba(66, 184, 131, 0.34);
  }
}
// The knob that says "a line ends here, build from it". Not interactive itself
// — the zone under it takes the click, across the whole half-tile.
.open-end {
  fill: #ffd76a;
  stroke: rgba(60, 44, 8, 0.75);
  stroke-width: 2;
  pointer-events: none;
  animation: open-end-pulse 1.6s ease-in-out infinite alternate;
}
@keyframes open-end-pulse {
  from {
    opacity: 0.65;
  }
  to {
    opacity: 1;
  }
}
.zone--armed,
.zone--armed:hover {
  fill: rgba(255, 179, 0, 0.45);
}
.zone--finish,
.zone--finish:hover {
  fill: rgba(255, 82, 82, 0.55);
  stroke: #d32f2f;
  stroke-width: 2;
  animation: finish-pulse 1s ease-in-out infinite alternate;
}
@keyframes finish-pulse {
  from {
    fill: rgba(255, 82, 82, 0.3);
  }
  to {
    fill: rgba(255, 82, 82, 0.65);
  }
}
// Translucent ghost of the rails a commit would lay; red when the route cannot
// be afforded (the tag says why) — a refusal you can see before you click.
.preview-rail {
  fill: none;
  stroke: #2c3e50;
  stroke-width: 4;
  opacity: 0.45;
  stroke-linecap: round;
  pointer-events: none;
}
.preview-rail--refused {
  stroke: #d32f2f;
  opacity: 0.6;
}
// The head/frontier tile of an in-progress route.
.level-tile--build-glow {
  outline: 3px solid rgba(255, 179, 0, 0.75);
  outline-offset: -3px;
}
// The live price tag riding the hovered tile (Train Valley's -2000$).
.build-cost-tag {
  position: absolute;
  z-index: 9; // above the fare pins — it is the thing being decided right now
  top: 0;
  left: 0;
  padding: 4px 11px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: rgba(18, 22, 28, 0.92);
  color: #f4d47a;
  font: 800 14px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
}
.build-cost-tag--refused {
  color: #ff6b5e;
  border-color: rgba(255, 107, 94, 0.6);
}
.score-card {
  position: fixed;
  z-index: 2000;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 340px;
  padding: 14px 22px 16px;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.92),
    rgba(18, 22, 28, 0.92)
  );
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;

  &--pulse {
    animation: score-pop 0.6s ease;
  }
  &--complete {
    border-color: rgba(224, 188, 92, 0.55);
    animation: score-breathe 1.8s ease-in-out infinite;
  }
}
.score-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.score-icon {
  font-size: 26px;
  line-height: 1;
}
.score-label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.score-count {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.score-now {
  font-size: 38px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  font-variant-numeric: tabular-nums;

  .score-card--complete & {
    color: #f0cf72;
    text-shadow: 0 0 16px rgba(240, 207, 114, 0.6);
  }
}
.score-sep {
  font-size: 22px;
  color: #5d6b77;
}
.score-total {
  font-size: 22px;
  font-weight: 700;
  color: #9aa7b2;
}
.score-check {
  margin-left: 4px;
  font-size: 22px;
  color: #5fd39a;
}
.score-bar {
  position: relative;
  height: 14px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.score-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f9e6b, #5fd39a);
  box-shadow: 0 0 12px rgba(95, 211, 154, 0.5);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  .score-card--complete & {
    background: linear-gradient(90deg, #d6a93c, #f5d97a);
    box-shadow: 0 0 14px rgba(245, 217, 122, 0.65);
  }
}
.score-pct {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.score-complete-banner {
  margin-top: 10px;
  text-align: center;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #f0cf72;
  text-shadow: 0 0 14px rgba(240, 207, 114, 0.55);
}
.score-banner-enter-active {
  transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.score-banner-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

@keyframes score-pop {
  0% {
    transform: translateX(-50%) scale(1);
  }
  35% {
    transform: translateX(-50%) scale(1.06);
  }
  100% {
    transform: translateX(-50%) scale(1);
  }
}
@keyframes score-breathe {
  0%,
  100% {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45),
      0 0 16px rgba(224, 188, 92, 0.25);
  }
  50% {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45),
      0 0 30px rgba(224, 188, 92, 0.5);
  }
}

.score-timer {
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #cdd7df;
}
.score-money {
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  font-size: 17px;
  letter-spacing: 0.01em;
  color: #f4d47a;
}
.score-calendar {
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 13px;
  color: #b6c2cc;
  // Replayed on every levy: the element is keyed on the tax paid, so a new
  // total re-creates it and the animation runs once. A silent balance drop is
  // the failure this guards against.
  animation: tax-levy 1.1s ease-out;
}
.score-tax {
  margin-left: 6px;
  color: #d9a3a3;
}
// Insolvency warning: the bill outgrew the balance. Loud on purpose — this is
// the last moment bulldozing can still save the run.
.score-calendar--broke {
  color: #e2574c;

  .score-tax {
    color: #e2574c;
  }
}
.score-tax-warn {
  display: block;
  margin-top: 2px;
  color: #e2574c;
  font-size: 12px;
  animation: tax-warn-pulse 1.6s ease-in-out infinite;
}
@keyframes tax-warn-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
@keyframes tax-levy {
  0% {
    color: #e2574c;
    transform: translateX(0);
  }
  15% {
    transform: translateX(-2px);
  }
  30% {
    transform: translateX(2px);
  }
  45% {
    transform: translateX(0);
  }
}
/* --- the service panel (network mode) ---
   The player's whole verb set in this mode: which trains run which stops, and
   ordering another when the service cannot keep up. Sits under the score card
   in the same frosted-glass idiom as the rest of the HUD chrome. */
.service-card {
  position: absolute;
  top: 16px;
  right: 16px;
  max-width: 340px;
  z-index: 30;
  min-width: 260px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(18, 22, 28, 0.82);
  backdrop-filter: blur(6px);
  color: #f3f5f7;
  font-size: 13px;
}
.service-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  margin-bottom: 6px;
}
.service-buy {
  border: 0;
  border-radius: 999px;
  padding: 3px 10px;
  font-weight: 700;
  cursor: pointer;
  background: #34c759;
  color: #08210f;
}
.service-buy:disabled {
  background: #3a4048;
  color: #8b939c;
  cursor: not-allowed;
}
.service-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.service-livery {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.6);
}
.service-id {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
.service-stops {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
/* A stop is a PLACE, so its chip sizes to the name rather than being a disc
   with a word crushed into it. */
.service-stop {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  background: #2b3138;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
/* The stop the train is actually heading for right now. */
.service-stop--next {
  background: #f0b429;
  color: #221803;
}
.service-retire {
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: transparent;
  color: #d98b84;
  padding: 2px 8px;
  cursor: pointer;
  line-height: 1.1;
}
.service-retire--on {
  color: #221803;
  background: #d98b84;
  border-color: transparent;
}
.service-queued {
  opacity: 0.75;
  font-size: 11px;
}
/* "3/16" beside a vehicle's id: the same reading as the gauge on the board, in
   a form you can compare down a list. */
.service-load {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
.service-idle {
  color: #8b939c;
  font-style: italic;
}
.service-edit {
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  padding: 2px 9px;
  cursor: pointer;
}
.service-edit--on {
  background: #f0b429;
  color: #221803;
  border-color: transparent;
  font-weight: 700;
}
/* How many trains run a line. Zero is a legitimate state — the plan stands
   whether or not anything serves it — but it is the thing to fix, so it is
   coloured as a warning rather than left to look like any other number. */
/* A bus has no livery colour of its own — it belongs to whichever line it is
   assigned to, and that line already wears the colour. The glyph is enough to
   tell the row apart from a train's. */
.service-livery--bus {
  background: transparent;
  font-size: 13px;
  line-height: 1;
  text-align: center;
}
.service-runners {
  font-size: 11px;
  color: #b9c0c8;
  white-space: nowrap;
}
.service-runners--none {
  color: #e8a33d;
  font-weight: 700;
}
.service-assign {
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.25);
  color: inherit;
  font: inherit;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
  max-width: 110px;
}
.service-hint {
  margin: 6px 0 0;
  color: #b9c0c8;
  font-size: 12px;
  line-height: 1.35;
}
/* A station you may click while drawing a line. */
.level-tile--pickable {
  cursor: pointer;
  outline: 3px dashed rgba(240, 180, 41, 0.9);
  outline-offset: -6px;
  border-radius: 6px;
}

/* The busiest platform (network mode): the same three-step temperature the
   crossing readout uses, because it is the same kind of pressure — something
   is piling up and the player has a little time to act. */
.score-platform {
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #8fd19e;
  transition: color 0.3s ease;
}
.score-platform--busy {
  color: #e6c34a;
}
.score-platform--critical {
  color: #e2574c;
}
.score-stars {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.star-pip {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.18);
  transition: color 0.3s ease, text-shadow 0.3s ease;
  &--on {
    color: #f0cf72;
    text-shadow: 0 0 10px rgba(240, 207, 114, 0.6);
  }
  &--lg {
    font-size: 34px;
  }
}
.game-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 11, 15, 0.62);
  backdrop-filter: blur(4px);
}
.overlay-card {
  min-width: 320px;
  padding: 28px 34px;
  text-align: center;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.97),
    rgba(18, 22, 28, 0.97)
  );
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}
.overlay-title {
  margin: 0 0 8px;
  font-size: 26px;
}
.overlay-desc {
  margin: 8px 0 18px;
  color: #9aa7b2;
  max-width: 360px;
}
.overlay-best {
  margin: 0 0 8px;
  color: #f0cf72;
  font-weight: 700;
}
// The goal list, on the Ready card (targets) and the win card (what you got).
// Boxed and left-aligned: it is a list to read down, not a badge row.
.overlay-goals {
  align-self: stretch;
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.overlay-goals-title {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7f8b96;
  text-align: left;
}
.overlay-btn {
  padding: 12px 28px;
  font-size: 16px;
  font-weight: 700;
  color: #0d1117;
  background: linear-gradient(90deg, #5fd39a, #2f9e6b);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  &:hover {
    filter: brightness(1.08);
  }
  &--ghost {
    margin-top: 10px;
    color: #cdd7df;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.18);
    font-weight: 600;
    &:hover {
      background: rgba(255, 255, 255, 0.08);
      filter: none;
    }
  }
}

// ---- Game-mode picker ----
.picker-card {
  width: min(720px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  padding: 26px 30px 22px;
  text-align: center;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.98),
    rgba(18, 22, 28, 0.98)
  );
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}
// The Spielstand overlay: a narrower picker card with a name row on top and
// one row per slot below it.
.saves-card {
  width: min(560px, 92vw);
}
.saves-new {
  display: flex;
  gap: 10px;
  margin: 14px 0 18px;
}
.saves-name {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: #eef2f6;
  font: inherit;
  &::placeholder {
    color: rgba(238, 242, 246, 0.45);
  }
}
.saves-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.saves-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
}
.saves-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.saves-sub {
  font-size: 12px;
  color: rgba(238, 242, 246, 0.55);
}
// Slot-row buttons are compact: the picker's overlay-btn is sized for a card
// footer, not for three of them beside every row.
.saves-act {
  margin: 0;
  padding: 7px 12px;
  font-size: 13px;
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin: 18px 0 8px;
}
.mode-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  position: relative;
  padding: 16px 16px 18px;
  text-align: left;
  color: #eef2f6;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease,
    background 0.15s ease;
  &:hover {
    transform: translateY(-2px);
    border-color: rgba(95, 211, 154, 0.6);
    background: rgba(95, 211, 154, 0.08);
  }
  &--active {
    border-color: rgba(240, 207, 114, 0.7);
    background: rgba(240, 207, 114, 0.1);
  }
}
.mode-card__icon {
  font-size: 30px;
  line-height: 1;
}
.mode-card__label {
  font-size: 17px;
  font-weight: 800;
}
.mode-card__desc {
  font-size: 12.5px;
  line-height: 1.4;
  color: #9aa7b2;
}
.mode-card__badge {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f0cf72;
}

// A mode the current board can't carry (#114): still on the grid so the
// roster reads complete, but visibly inert, with the missing requirement.
.mode-card--unfit {
  opacity: 0.55;
  cursor: not-allowed;

  &:hover {
    transform: none;
  }
}
.mode-card__unfit {
  font-size: 11px;
  font-weight: 700;
  color: #ffb37e;
}

.event-log {
  position: fixed;
  z-index: 2000;
  right: 0;
  top: 0;
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: rgba(20, 24, 28, 0.92);
  color: #d7dde3;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  border-bottom-left-radius: 6px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.4);
}
.event-log--min {
  width: auto;
}
.event-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 6px 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  .event-log--min & {
    border-bottom: none;
  }
}
.event-log-title {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.event-log-toggle {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  line-height: 18px;
  padding: 0;
  min-width: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: #d7dde3;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.18);
  }
}
.event-log-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
}
.event-log-empty {
  padding: 8px 10px;
  color: #6b7782;
  font-style: italic;
}
.event-log-entry {
  display: flex;
  gap: 6px;
  padding: 2px 10px;
  white-space: nowrap;
  border-left: 3px solid transparent;
  text-align: left;

  &.log-blocked {
    border-left-color: #e0564b;
  }
  &.log-proceeding {
    border-left-color: #4caf78;
  }
  &.log-reserved {
    border-left-color: #5b8dd6;
  }
  &.log-arrived {
    border-left-color: #d6b14c;
  }
}
.log-time {
  color: #6b7782;
  flex: 0 0 auto;
  min-width: 38px;
}
.log-train {
  font-weight: 700;
  flex: 0 0 auto;
}
.log-text {
  color: #d7dde3;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

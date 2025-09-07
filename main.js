// Main script for Work Grand Prix

/*
 * Application state and constants
 */
const STORAGE_KEY = 'workGrandPrixData';
const CURRENT_USER_KEY = 'workGrandPrixCurrentUser';
const SECTOR_DURATION_MS = 45 * 60 * 1000; // 45 minutes in milliseconds
const MIN_TASKS = 4;
const MAX_TASKS = 15;

let data = null;            // Loaded data from localStorage
let currentUser = null;     // Logged in user name
let currentSector = null;   // Currently selected sector number
let sectorTimerInterval = null; // Interval reference for sector timer
// Broadcast channel for cross-tab communication (online status, friend requests, invites).
// Using BroadcastChannel allows different tabs of the same browser to communicate without a server.
const channel = new BroadcastChannel('workGrandPrixChannel');
// Keep track of who is currently online (across tabs). When a user logs in or out we update this map.
let onlineUsers = {};

/**
 * Ensure the social data (friends and friend requests) exist for a user.
 * This helper creates empty arrays if they are missing.
 */
function ensureUserSocialData(username) {
  if (!data.users[username].friends) {
    data.users[username].friends = [];
  }
  if (!data.users[username].friendRequests) {
    data.users[username].friendRequests = [];
  }
}

/**
 * Add a friend relationship locally between the current user and another user.
 * Also cleans up any pending friend requests between the two users.
 */
function addFriendLocal(friend) {
  ensureUserSocialData(currentUser);
  ensureUserSocialData(friend);
  if (!data.users[currentUser].friends.includes(friend)) {
    data.users[currentUser].friends.push(friend);
  }
  if (!data.users[friend].friends.includes(currentUser)) {
    data.users[friend].friends.push(currentUser);
  }
  // remove friend from current user's pending requests
  const idx = data.users[currentUser].friendRequests.indexOf(friend);
  if (idx !== -1) {
    data.users[currentUser].friendRequests.splice(idx, 1);
  }
  // remove current user from friend's pending requests
  const idx2 = data.users[friend].friendRequests.indexOf(currentUser);
  if (idx2 !== -1) {
    data.users[friend].friendRequests.splice(idx2, 1);
  }
  saveData();
}

/**
 * Utility: Get current date string in YYYY-MM-DD format.
 */
function getTodayKey() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Utility: Compute the Monday of the week for a given date.
 * Returns a Date object representing Monday.
 */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day; // shift days to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

/**
 * Utility: Format milliseconds to hh:mm:ss or mm:ss.
 */
function formatDuration(ms) {
  if (ms < 0 || isNaN(ms)) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } else {
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}

/**
 * Load persistent data from localStorage or initialise empty structure.
 */
function loadData() {
  const json = localStorage.getItem(STORAGE_KEY);
  if (json) {
    try {
      return JSON.parse(json);
    } catch (e) {
      console.error('Failed to parse stored data:', e);
    }
  }
  return { users: {} };
}

/**
 * Persist data back to localStorage.
 */
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Save current user name to sessionStorage/localStorage for persistent login.
 */
function saveCurrentUser(username) {
  localStorage.setItem(CURRENT_USER_KEY, username);
}

/**
 * Clear current user from storage.
 */
function clearCurrentUser() {
  localStorage.removeItem(CURRENT_USER_KEY);
}

/**
 * Load current user name if previously logged in.
 */
function loadCurrentUser() {
  return localStorage.getItem(CURRENT_USER_KEY);
}

/**
 * Announce to other tabs that this user is online/offline.
 * Uses the BroadcastChannel defined at the top of the script.
 */
function announceOnline(user) {
  channel.postMessage({ type: 'online', user });
}

function announceOffline(user) {
  channel.postMessage({ type: 'offline', user });
}

// Listen for messages from other tabs for online presence, friend requests, accepts and race invites.
channel.onmessage = (event) => {
  const msg = event.data || {};
  switch (msg.type) {
    case 'online':
      // mark user as online
      onlineUsers[msg.user] = true;
      if (currentUser) {
        renderFriendsAndOnline();
      }
      break;
    case 'offline':
      // remove user from online list
      delete onlineUsers[msg.user];
      if (currentUser) {
        renderFriendsAndOnline();
      }
      break;
    case 'friendRequest':
      if (msg.to === currentUser) {
        // ensure lists exist
        ensureUserSocialData(currentUser);
        // if not already friends or already requested
        const from = msg.from;
        const alreadyFriend = data.users[currentUser].friends && data.users[currentUser].friends.includes(from);
        const alreadyRequested = data.users[currentUser].friendRequests && data.users[currentUser].friendRequests.includes(from);
        if (!alreadyFriend && !alreadyRequested) {
          data.users[currentUser].friendRequests.push(from);
          saveData();
          renderFriendsAndOnline();
        }
      }
      break;
    case 'friendAccepted':
      if (msg.to === currentUser) {
        addFriendLocal(msg.from);
        renderFriendsAndOnline();
      }
      break;
    case 'raceInvite':
      if (msg.to === currentUser) {
        // simple confirm to accept invite
        if (confirm(`${msg.from} invited you to race! Start now?`)) {
          // navigate to sector selection for a new race
          renderSectorSelection();
        }
      }
      break;
    default:
      break;
  }
};

/**
 * Compute weekly leaderboard for the current week (Monday–Saturday).
 * Returns an array of objects { username, totalTimeMs } sorted by time.
 */
function computeCurrentWeekLeaderboard() {
  const results = [];
  const today = new Date();
  const monday = getMonday(today);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5); // Monday + 5 = Saturday
  saturday.setHours(23,59,59,999);

  for (const [username, userData] of Object.entries(data.users)) {
    let total = 0;
    if (userData.records) {
      for (const [dateKey, record] of Object.entries(userData.records)) {
        const recordDate = new Date(dateKey + 'T00:00:00');
        if (recordDate >= monday && recordDate <= saturday) {
          for (const sectorNum of ['1','2','3']) {
            const sector = record.sectors && record.sectors[sectorNum];
            if (sector && sector.tasks) {
              for (const task of sector.tasks) {
                if (task.status === 'Finished' && typeof task.duration === 'number') {
                  total += task.duration;
                }
              }
            }
          }
        }
      }
    }
    if (total > 0) {
      results.push({ username, totalTimeMs: total });
    }
  }
  results.sort((a, b) => a.totalTimeMs - b.totalTimeMs);
  return results;
}

/**
 * Update leaderboard display.
 */
function renderLeaderboard(container) {
  const results = computeCurrentWeekLeaderboard();
  if (results.length === 0) {
    container.innerHTML = '<p>No data for this week yet.</p>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'leaderboard-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Position</th><th>Driver</th><th>Total Time</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  results.forEach((item, index) => {
    const tr = document.createElement('tr');
    const posTd = document.createElement('td');
    posTd.className = 'position';
    posTd.textContent = index + 1;
    const nameTd = document.createElement('td');
    nameTd.textContent = item.username;
    const timeTd = document.createElement('td');
    timeTd.textContent = formatDuration(item.totalTimeMs);
    tr.appendChild(posTd);
    tr.appendChild(nameTd);
    tr.appendChild(timeTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

/**
 * Render friends, friend requests, and online users with actions.
 * Called within renderWelcome and whenever presence or social data changes.
 */
function renderFriendsAndOnline() {
  const container = document.getElementById('friends-container');
  if (!container) return;
  container.innerHTML = '';
  ensureUserSocialData(currentUser);
  // Friend Requests
  const requests = data.users[currentUser].friendRequests || [];
  if (requests.length > 0) {
    const reqTitle = document.createElement('h4');
    reqTitle.textContent = 'Friend Requests';
    container.appendChild(reqTitle);
    requests.forEach(reqUser => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      const span = document.createElement('span');
      span.textContent = reqUser;
      row.appendChild(span);
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'button small';
      acceptBtn.textContent = 'Accept';
      acceptBtn.addEventListener('click', () => {
        addFriendLocal(reqUser);
        channel.postMessage({ type: 'friendAccepted', from: currentUser, to: reqUser });
        renderFriendsAndOnline();
      });
      row.appendChild(acceptBtn);
      container.appendChild(row);
    });
  }
  // Friends list
  const friendsList = data.users[currentUser].friends || [];
  if (friendsList.length > 0) {
    const friendsTitle = document.createElement('h4');
    friendsTitle.textContent = 'Your Friends';
    container.appendChild(friendsTitle);
    friendsList.forEach(friend => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      const span = document.createElement('span');
      span.textContent = friend;
      row.appendChild(span);
      if (onlineUsers[friend]) {
        const inviteBtn = document.createElement('button');
        inviteBtn.className = 'button small';
        inviteBtn.textContent = 'Invite to Race';
        inviteBtn.addEventListener('click', () => {
          channel.postMessage({ type: 'raceInvite', from: currentUser, to: friend });
          alert(`Race invite sent to ${friend}.`);
        });
        row.appendChild(inviteBtn);
      }
      container.appendChild(row);
    });
  }
  // Online users who are not friends
  const others = Object.keys(onlineUsers).filter(u => u !== currentUser && !friendsList.includes(u));
  if (others.length > 0) {
    const onlineTitle = document.createElement('h4');
    onlineTitle.textContent = 'Online Users';
    container.appendChild(onlineTitle);
    others.forEach(user => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      const span = document.createElement('span');
      span.textContent = user;
      row.appendChild(span);
      const addBtn = document.createElement('button');
      addBtn.className = 'button small';
      addBtn.textContent = 'Add Friend';
      addBtn.addEventListener('click', () => {
        channel.postMessage({ type: 'friendRequest', from: currentUser, to: user });
        alert(`Friend request sent to ${user}.`);
      });
      row.appendChild(addBtn);
      container.appendChild(row);
    });
  }
}

/**
 * Render login or register form.
 */
function renderAuthForm(isLogin = true) {
  clearInterval(sectorTimerInterval);
  sectorTimerInterval = null;
  currentSector = null;
  const app = document.getElementById('app');
  app.innerHTML = '';
  const formContainer = document.createElement('div');
  formContainer.className = 'form-container';
  const heading = document.createElement('h2');
  heading.textContent = isLogin ? 'Login to Work Grand Prix' : 'Create your account';
  formContainer.appendChild(heading);
  const form = document.createElement('form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const username = form.elements['username'].value.trim();
    const password = form.elements['password'].value;
    if (!username || !password) {
      alert('Please enter both username and password.');
      return;
    }
    if (isLogin) {
      // handle login
      if (!data.users[username]) {
        alert('User not found. Please register.');
        return;
      }
      const stored = data.users[username].password;
      if (stored !== password) {
        alert('Incorrect password.');
        return;
      }
      currentUser = username;
      saveCurrentUser(username);
      saveData();
      renderWelcome();
    } else {
      // handle registration
      if (data.users[username]) {
        alert('Username already exists. Please choose another.');
        return;
      }
      // create user with password, empty records and empty social data
      data.users[username] = {
        password: password,
        records: {},
        friends: [],
        friendRequests: []
      };
      saveData();
      alert('Account created! You can now log in.');
      renderAuthForm(true);
    }
  };
  // username
  const usernameLabel = document.createElement('label');
  usernameLabel.textContent = 'Username';
  const usernameInput = document.createElement('input');
  usernameInput.type = 'text';
  usernameInput.name = 'username';
  usernameInput.autocomplete = 'username';
  // password
  const passwordLabel = document.createElement('label');
  passwordLabel.textContent = 'Password';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.name = 'password';
  passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'button';
  submitButton.textContent = isLogin ? 'Login' : 'Register';
  // append elements
  form.appendChild(usernameLabel);
  form.appendChild(usernameInput);
  form.appendChild(passwordLabel);
  form.appendChild(passwordInput);
  form.appendChild(submitButton);
  formContainer.appendChild(form);
  // switch link
  const switchDiv = document.createElement('div');
  switchDiv.className = 'form-switch';
  if (isLogin) {
    switchDiv.innerHTML = 'New here? <a id="switch-to-register">Register now</a>';
  } else {
    switchDiv.innerHTML = 'Already have an account? <a id="switch-to-login">Login here</a>';
  }
  formContainer.appendChild(switchDiv);
  app.appendChild(formContainer);
  // attach switch listener
  const link = isLogin ? document.getElementById('switch-to-register') : document.getElementById('switch-to-login');
  link.addEventListener('click', (e) => {
    e.preventDefault();
    renderAuthForm(!isLogin);
  });
}

/**
 * Render the welcome page after login.
 */
function renderWelcome() {
  clearInterval(sectorTimerInterval);
  sectorTimerInterval = null;
  currentSector = null;
  const app = document.getElementById('app');
  app.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'welcome-container';
  // dynamic greeting based on time
  const now = new Date();
  const hours = now.getHours();
  let greeting = 'Hello';
  if (hours < 12) greeting = 'Good morning';
  else if (hours < 18) greeting = 'Good afternoon';
  else greeting = 'Good evening';
  const heading = document.createElement('h1');
  heading.textContent = `${greeting}, ${currentUser}!`;
  container.appendChild(heading);
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Ready to race through your workday?';
  container.appendChild(subtitle);
  const cta = document.createElement('button');
  cta.className = 'button cta-button';
  cta.innerHTML = '<i class="fa-solid fa-flag-checkered"></i> Start Your Work Grand Prix';
  cta.addEventListener('click', () => {
    renderSectorSelection();
  });
  container.appendChild(cta);
  // logout button
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'button secondary small';
  logoutBtn.style.marginTop = '20px';
  logoutBtn.innerHTML = '<i class="fa-solid fa-sign-out-alt"></i> Logout';
  logoutBtn.addEventListener('click', () => {
    // announce offline presence
    if (currentUser) {
      announceOffline(currentUser);
    }
    currentUser = null;
    clearCurrentUser();
    renderAuthForm(true);
  });
  container.appendChild(logoutBtn);

  // history button to view past sectors and tasks
  const historyBtn = document.createElement('button');
  historyBtn.className = 'button secondary small';
  historyBtn.style.marginTop = '10px';
  historyBtn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> View History';
  historyBtn.addEventListener('click', () => {
    renderHistory();
  });
  container.appendChild(historyBtn);
  // leaderboard
  const leaderboardDiv = document.createElement('div');
  leaderboardDiv.className = 'leaderboard-container';
  const lbTitle = document.createElement('h3');
  lbTitle.innerHTML = '<i class="fa-solid fa-trophy"></i> Weekly Leaderboard';
  leaderboardDiv.appendChild(lbTitle);
  const lbBody = document.createElement('div');
  lbBody.id = 'leaderboard-body';
  leaderboardDiv.appendChild(lbBody);
  container.appendChild(leaderboardDiv);
  // Friends & online container
  const friendsDiv = document.createElement('div');
  friendsDiv.id = 'friends-container';
  friendsDiv.className = 'friends-container';
  container.appendChild(friendsDiv);
  app.appendChild(container);
  // render leaderboard
  renderLeaderboard(lbBody);
  // render friends/online lists
  renderFriendsAndOnline();
  // announce that current user is online
  announceOnline(currentUser);
}

/**
 * Render sector selection page.
 */
function renderSectorSelection() {
  clearInterval(sectorTimerInterval);
  sectorTimerInterval = null;
  currentSector = null;
  const app = document.getElementById('app');
  app.innerHTML = '';
  const header = document.createElement('h2');
  header.innerHTML = '<i class="fa-solid fa-road"></i> Choose Your Sector';
  app.appendChild(header);
  const grid = document.createElement('div');
  grid.className = 'sector-grid';
  for (let i = 1; i <= 3; i++) {
    const card = document.createElement('div');
    card.className = 'sector-card';
    const icon = document.createElement('div');
    icon.className = 'sector-icon';
    // choose different icons for sectors
    if (i === 1) icon.innerHTML = '<i class="fa-solid fa-helmet-safety"></i>';
    else if (i === 2) icon.innerHTML = '<i class="fa-solid fa-flag"></i>';
    else icon.innerHTML = '<i class="fa-solid fa-gauge-high"></i>';
    card.appendChild(icon);
    const title = document.createElement('h3');
    title.textContent = `Sector ${i}`;
    card.appendChild(title);
    const description = document.createElement('p');
    description.textContent = '45 minute sprint';
    card.appendChild(description);
    card.addEventListener('click', () => {
      currentSector = i;
      renderSectorTasks();
    });
    grid.appendChild(card);
  }
  app.appendChild(grid);
  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'button secondary small';
  backBtn.style.marginTop = '30px';
  backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
  backBtn.addEventListener('click', () => {
    renderWelcome();
  });
  app.appendChild(backBtn);
}

/**
 * Ensure records structure exists for current user/date/sector.
 */
function ensureCurrentSectorData() {
  const todayKey = getTodayKey();
  if (!data.users[currentUser].records) {
    data.users[currentUser].records = {};
  }
  if (!data.users[currentUser].records[todayKey]) {
    data.users[currentUser].records[todayKey] = { sectors: {} };
  }
  const sectors = data.users[currentUser].records[todayKey].sectors;
  if (!sectors[currentSector]) {
    sectors[currentSector] = {
      startTime: null,
      tasks: []
    };
  }
}

/**
 * Render tasks management page for selected sector.
 */
function renderSectorTasks() {
  ensureCurrentSectorData();
  const sectorData = data.users[currentUser].records[getTodayKey()].sectors[currentSector];
  // Do not auto start the sector timer. The user must enter tasks and press Ready.
  clearInterval(sectorTimerInterval);
  const app = document.getElementById('app');
  app.innerHTML = '';
  // header with sector title and timer
  const header = document.createElement('div');
  header.className = 'tasks-header';
  const title = document.createElement('h2');
  title.innerHTML = `<i class="fa-solid fa-stopwatch"></i> Sector ${currentSector}`;
  header.appendChild(title);
  const timerElem = document.createElement('div');
  timerElem.className = 'timer';
  header.appendChild(timerElem);
  app.appendChild(header);

  // tasks table
  const tasksContainer = document.createElement('div');
  tasksContainer.className = 'tasks-container';
  const table = document.createElement('table');
  table.className = 'task-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>#</th><th>Task</th><th>Status</th><th>Elapsed</th><th>Actions</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  tasksContainer.appendChild(table);
  app.appendChild(tasksContainer);

  // add / remove task controls
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '10px';
  controls.style.marginTop = '10px';
  const addBtn = document.createElement('button');
  addBtn.className = 'button small';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Task';
  addBtn.addEventListener('click', () => {
    // prevent adding new tasks after sector start
    if (sectorData.startTime) {
      alert('Cannot add tasks after the sector has started.');
      return;
    }
    if (sectorData.tasks.length >= MAX_TASKS) {
      alert(`Maximum ${MAX_TASKS} tasks allowed in a sector.`);
      return;
    }
    const newTask = {
      id: Date.now() + '_' + Math.random().toString(36).substr(2,5),
      name: '',
      status: 'Not started',
      startTime: null,
      endTime: null,
      pauseDuration: 0,
      pauseStart: null,
      duration: null
    };
    sectorData.tasks.push(newTask);
    saveData();
    renderSectorTasks();
  });
  const removeBtn = document.createElement('button');
  removeBtn.className = 'button small secondary';
  removeBtn.innerHTML = '<i class="fa-solid fa-minus"></i> Remove Task';
  removeBtn.addEventListener('click', () => {
    // prevent removing tasks after sector start
    if (sectorData.startTime) {
      alert('Cannot remove tasks after the sector has started.');
      return;
    }
    if (sectorData.tasks.length <= MIN_TASKS) {
      alert(`Minimum ${MIN_TASKS} tasks required in a sector.`);
      return;
    }
    sectorData.tasks.pop();
    saveData();
    renderSectorTasks();
  });
  controls.appendChild(addBtn);
  controls.appendChild(removeBtn);
  app.appendChild(controls);
  // Ready button to start the sector after entering tasks
  const readyBtn = document.createElement('button');
  readyBtn.className = 'button';
  readyBtn.style.marginTop = '20px';
  readyBtn.innerHTML = '<i class="fa-solid fa-flag"></i> Ready';
  readyBtn.addEventListener('click', () => {
    // ensure minimum tasks
    if (sectorData.tasks.length < MIN_TASKS) {
      alert(`Please add at least ${MIN_TASKS} tasks before starting.`);
      return;
    }
    // start countdown before starting the sector
    readyBtn.disabled = true;
    startCountdown(() => {
      sectorData.startTime = Date.now();
      saveData();
      // start timer interval
      updateSectorTimer();
      clearInterval(sectorTimerInterval);
      sectorTimerInterval = setInterval(updateSectorTimer, 1000);
    });
  });
  app.appendChild(readyBtn);
  // back button to sectors
  const backBtn = document.createElement('button');
  backBtn.className = 'button secondary small';
  backBtn.style.marginTop = '10px';
  backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back to Sectors';
  backBtn.addEventListener('click', () => {
    renderSectorSelection();
  });
  app.appendChild(backBtn);

  // fill table rows for tasks
  function updateTaskRows() {
    tbody.innerHTML = '';
    sectorData.tasks.forEach((task, index) => {
      const tr = document.createElement('tr');
      // index
      const idxTd = document.createElement('td');
      idxTd.textContent = index + 1;
      tr.appendChild(idxTd);
      // task name
      const nameTd = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = task.name;
      nameInput.placeholder = `Task ${index + 1}`;
      nameInput.addEventListener('change', (e) => {
        task.name = e.target.value;
        saveData();
      });
      nameTd.appendChild(nameInput);
      tr.appendChild(nameTd);
      // status
      const statusTd = document.createElement('td');
      statusTd.textContent = task.status;
      tr.appendChild(statusTd);
      // elapsed
      const elapsedTd = document.createElement('td');
      // compute elapsed time based on status
      function computeElapsed() {
        if (task.status === 'Not started') return '00:00';
        let now = Date.now();
        let elapsed = 0;
        if (task.status === 'Running') {
          elapsed = now - task.startTime - task.pauseDuration;
        } else if (task.status === 'Paused') {
          elapsed = task.pauseStart ? (task.pauseStart - task.startTime - task.pauseDuration) : 0;
        } else if (task.status === 'Finished') {
          elapsed = task.duration || 0;
        }
        return formatDuration(elapsed);
      }
      elapsedTd.textContent = computeElapsed();
      tr.appendChild(elapsedTd);
      // actions
      const actionsTd = document.createElement('td');
      actionsTd.className = 'task-actions';
      // Start button
      const startBtn = document.createElement('button');
      startBtn.className = 'button small';
      startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start';
      startBtn.addEventListener('click', () => {
        // do not allow starting tasks before sector start
        if (!sectorData.startTime) {
          alert('You need to start the sector first by clicking Ready.');
          return;
        }
        if (task.status === 'Finished') {
          alert('Task already finished.');
          return;
        }
        if (task.status === 'Not started') {
          task.startTime = Date.now();
          task.pauseDuration = 0;
          task.pauseStart = null;
          task.status = 'Running';
        } else if (task.status === 'Paused') {
          // resume from pause
          if (task.pauseStart) {
            task.pauseDuration += Date.now() - task.pauseStart;
            task.pauseStart = null;
          }
          task.status = 'Running';
        } else if (task.status === 'Running') {
          // nothing
          return;
        }
        saveData();
        updateTaskRows();
      });
      // Stop button
      const stopBtn = document.createElement('button');
      stopBtn.className = 'button small secondary';
      stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
      stopBtn.addEventListener('click', () => {
        if (task.status === 'Not started') return;
        // reset the task
        task.status = 'Not started';
        task.startTime = null;
        task.pauseDuration = 0;
        task.pauseStart = null;
        task.endTime = null;
        task.duration = null;
        saveData();
        updateTaskRows();
      });
      // Pit-stop button (pause)
      const pitBtn = document.createElement('button');
      pitBtn.className = 'button small secondary';
      pitBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pit-stop';
      pitBtn.addEventListener('click', () => {
        if (task.status !== 'Running') {
          return;
        }
        task.status = 'Paused';
        task.pauseStart = Date.now();
        saveData();
        updateTaskRows();
      });
      // Finish lap button
      const finishBtn = document.createElement('button');
      finishBtn.className = 'button small';
      finishBtn.innerHTML = '<i class="fa-solid fa-flag-checkered"></i> Finish';
      finishBtn.addEventListener('click', () => {
        if (task.status === 'Finished') {
          return;
        }
        if (task.status === 'Not started') {
          alert('Start the task before finishing.');
          return;
        }
        // if paused, accumulate pause duration
        if (task.status === 'Paused' && task.pauseStart) {
          task.pauseDuration += Date.now() - task.pauseStart;
          task.pauseStart = null;
        }
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime - task.pauseDuration;
        if (task.duration < 0) task.duration = 0;
        task.status = 'Finished';
        saveData();
        updateTaskRows();
        // update leaderboard on finish
        renderLeaderboard(document.getElementById('leaderboard-body'));
      });
      actionsTd.appendChild(startBtn);
      actionsTd.appendChild(pitBtn);
      actionsTd.appendChild(stopBtn);
      actionsTd.appendChild(finishBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }
  updateTaskRows();

  // sector timer update
  function updateSectorTimer() {
    if (!sectorData.startTime) {
      // timer not started yet: show full duration
      timerElem.textContent = formatDuration(SECTOR_DURATION_MS);
      updateTaskRows();
      return;
    }
    const now = Date.now();
    const elapsed = now - sectorData.startTime;
    const remaining = SECTOR_DURATION_MS - elapsed;
    if (remaining <= 0) {
      timerElem.textContent = '00:00';
      clearInterval(sectorTimerInterval);
      sectorTimerInterval = null;
      return;
    }
    timerElem.textContent = formatDuration(remaining);
    // also refresh task elapsed times
    updateTaskRows();
  }
  // initial display
  updateSectorTimer();
  // start interval only if sector already started
  if (sectorData.startTime) {
    sectorTimerInterval = setInterval(updateSectorTimer, 1000);
  } else {
    sectorTimerInterval = null;
  }
}

/**
 * Initial application entry point.
 */
function init() {
  data = loadData();
  currentUser = loadCurrentUser();
  if (currentUser && data.users[currentUser]) {
    renderWelcome();
  } else {
    clearCurrentUser();
    renderAuthForm(true);
  }
}

/**
 * Display a Formula 1–style countdown before starting a sector.
 * Creates an overlay with five lights that illuminate sequentially each second.
 * When the countdown completes, the provided callback is invoked.
 */
function startCountdown(callback) {
  // create overlay
  const overlay = document.createElement('div');
  overlay.className = 'countdown-overlay';
  // create lights
  const lights = [];
  for (let i = 0; i < 5; i++) {
    const light = document.createElement('div');
    light.className = 'countdown-light';
    overlay.appendChild(light);
    lights.push(light);
  }
  document.body.appendChild(overlay);
  let step = 0;
  function ignite() {
    if (step < lights.length) {
      lights[step].classList.add('active');
      step++;
      setTimeout(ignite, 1000);
    } else {
      // all lights lit: wait half second then remove overlay and call callback
      setTimeout(() => {
        overlay.remove();
        if (typeof callback === 'function') callback();
      }, 500);
    }
  }
  ignite();
}

/**
 * Render the history page showing past tasks and sector times for the current user.
 * Displays data grouped by date and sector. Each task shows its name and duration.
 */
function renderHistory() {
  clearInterval(sectorTimerInterval);
  sectorTimerInterval = null;
  const app = document.getElementById('app');
  app.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'history-container';
  const heading = document.createElement('h2');
  heading.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Your Work History';
  container.appendChild(heading);
  ensureUserSocialData(currentUser);
  const records = data.users[currentUser].records || {};
  const dates = Object.keys(records).sort((a,b) => new Date(b) - new Date(a));
  if (dates.length === 0) {
    const noData = document.createElement('p');
    noData.textContent = 'No history available yet.';
    container.appendChild(noData);
  } else {
    dates.forEach(dateKey => {
      const dateDiv = document.createElement('div');
      dateDiv.className = 'history-date';
      const dateHeader = document.createElement('h3');
      // format date to more friendly string
      const d = new Date(dateKey + 'T00:00:00');
      dateHeader.textContent = d.toDateString();
      dateDiv.appendChild(dateHeader);
      const sectors = records[dateKey].sectors || {};
      ['1','2','3'].forEach(sectorNum => {
        const sector = sectors[sectorNum];
        if (!sector || !sector.tasks || sector.tasks.length === 0) return;
        const sectorDiv = document.createElement('div');
        sectorDiv.className = 'history-sector';
        const sectorHeader = document.createElement('h4');
        sectorHeader.textContent = `Sector ${sectorNum}`;
        sectorDiv.appendChild(sectorHeader);
        // compute total time for sector (sum of finished task durations)
        let totalSector = 0;
        sector.tasks.forEach(task => {
          if (task.status === 'Finished' && typeof task.duration === 'number') {
            totalSector += task.duration;
          }
        });
        const sectorTotal = document.createElement('p');
        sectorTotal.textContent = `Total time: ${formatDuration(totalSector)}`;
        sectorDiv.appendChild(sectorTotal);
        // tasks list
        const list = document.createElement('ul');
        list.className = 'history-task-list';
        sector.tasks.forEach((task, idx) => {
          const li = document.createElement('li');
          const nameSpan = document.createElement('span');
          nameSpan.textContent = task.name || `Task ${idx + 1}`;
          const timeSpan = document.createElement('span');
          let dur = '—';
          if (task.status === 'Finished' && typeof task.duration === 'number') {
            dur = formatDuration(task.duration);
          }
          timeSpan.textContent = dur;
          li.appendChild(nameSpan);
          li.appendChild(document.createTextNode(' – '));
          li.appendChild(timeSpan);
          list.appendChild(li);
        });
        sectorDiv.appendChild(list);
        dateDiv.appendChild(sectorDiv);
      });
      container.appendChild(dateDiv);
    });
  }
  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'button secondary small';
  backBtn.style.marginTop = '20px';
  backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
  backBtn.addEventListener('click', () => {
    renderWelcome();
  });
  container.appendChild(backBtn);
  app.appendChild(container);
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
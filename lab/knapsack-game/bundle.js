// Fixed version of bundle.js for the Knapsack Game with random infeasibility risk per round
const ITEMS = [
  { id: 1, value: 2, weight: 3 },
  { id: 2, value: 3, weight: 4 },
  { id: 3, value: 4, weight: 6 },
  { id: 4, value: 5, weight: 5 },
  { id: 5, value: 6, weight: 13 },
  { id: 6, value: 9, weight: 8 },
  { id: 7, value: 6, weight: 6 },
  { id: 8, value: 5, weight: 9 },
  { id: 9, value: 8, weight: 2 },
  { id: 10, value: 5, weight: 4 },
  { id: 11, value: 9, weight: 7 },
  { id: 12, value: 9, weight: 7 },
];

const MAX_WEIGHT = 14;
const TARGET_VALUE = 22;
const RISK_LEVELS = [0, 0.2, 0.8];
const VISIBILITY_MODES = ["Daylight", "Darkness", "Silent"];

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function KnapsackGame() {
  const [round, setRound] = React.useState(0);
  const [selectedItems, setSelectedItems] = React.useState([]);
  const [availableItems, setAvailableItems] = React.useState(shuffleArray(ITEMS));
  const [draggedItem, setDraggedItem] = React.useState(null);
  const [visibility, setVisibility] = React.useState(VISIBILITY_MODES[0]);
  const [risk, setRisk] = React.useState(getRandomElement(RISK_LEVELS));
  const [quit, setQuit] = React.useState(false);

  const SHEET_URL = "https://knapsack-proxy.vercel.app/api/submit";

  const sendToSheet = () => {
    const sessionId = localStorage.getItem("knapsack_session") || (() => {
      const id = crypto.randomUUID();
      localStorage.setItem("knapsack_session", id);
      return id;
    })();

    const currentWeight = selectedItems.reduce((acc, item) => acc + item.weight, 0);
    const currentValue = selectedItems.reduce((acc, item) => acc + item.value, 0);

    const rowData = {
      timestamp: new Date().toISOString(),
      sessionId,
      round: round + 1,
      selectedItems: selectedItems.map(i => `ID:${i.id},V:${i.value},W:${i.weight}`).join(" | "),
      totalValue: currentValue,
      totalWeight: currentWeight,
      risk,
      visibility
    };

    fetch(SHEET_URL, {
      method: "POST",
      body: JSON.stringify(rowData),
      headers: { "Content-Type": "application/json" },
    }).then(res => res.text()).then(console.log).catch(console.error);
  };

  React.useEffect(() => {
    setAvailableItems(shuffleArray(ITEMS));
    setSelectedItems([]);
    setRisk(getRandomElement(RISK_LEVELS)); // Assign new risk each round
  }, [round]);

  const currentWeight = selectedItems.reduce((acc, item) => acc + item.weight, 0);
  const currentValue = selectedItems.reduce((acc, item) => acc + item.value, 0);
  const weightLeft = MAX_WEIGHT - currentWeight;

  const onDropToKnapsack = () => {
    if (!draggedItem) return;
    if (!selectedItems.some(i => i.id === draggedItem.id) && currentWeight + draggedItem.weight <= MAX_WEIGHT) {
      setSelectedItems([...selectedItems, draggedItem]);
      setAvailableItems(availableItems.filter(i => i.id !== draggedItem.id));
    }
    setDraggedItem(null);
  };

  const onDropToAvailable = () => {
    if (!draggedItem) return;
    if (!availableItems.some(i => i.id === draggedItem.id)) {
      setAvailableItems([...availableItems, draggedItem]);
      setSelectedItems(selectedItems.filter(i => i.id !== draggedItem.id));
    }
    setDraggedItem(null);
  };

  const maxWeight = Math.max(...ITEMS.map(i => i.weight));
  const maxValue = Math.max(...ITEMS.map(i => i.value));

  const getItemStyle = (item) => {
    const weightRatio = item.weight / maxWeight;
    const valueRatio = item.value / maxValue;
    const baseSize = 80;
    const dynamicSize = 60 * weightRatio;
    const width = baseSize + dynamicSize;
    const height = 60 + 20 * weightRatio;
    const lightness = 90 - valueRatio * 40;
    const color = `hsl(45, 100%, ${lightness}%)`;
    return {
      borderRadius: "12px",
      padding: "10px",
      cursor: "grab",
      textAlign: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      transition: "all 0.2s",
      minWidth: `${width}px`,
      height: `${height}px`,
      backgroundColor: color,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
    };
  };

  const renderItem = (item) => (
    React.createElement("div", {
      key: item.id,
      draggable: true,
      onDragStart: () => setDraggedItem(item),
      onTouchStart: () => setDraggedItem(item),
      style: getItemStyle(item),
    },
      React.createElement("p", { style: { margin: 0, fontWeight: "bold" } }, `$${item.value}`),
      React.createElement("p", { style: { margin: 0 } }, `${item.weight} Kg`)
    )
  );

  return React.createElement("div", { style: { padding: "30px", fontFamily: "'Segoe UI', 'Inter', sans-serif", maxWidth: "900px", margin: "auto" } },
    React.createElement("h1", { style: { fontSize: "28px", marginBottom: "10px" } }, "🎒 Knapsack Contest Game"),
    React.createElement("p", null, `Round: ${round + 1}`),
    React.createElement("p", null, `Visibility Mode: ${visibility}`),
    React.createElement("p", null, `Infeasibility Risk: ${risk * 100}%`),

    React.createElement("div", {
      onDragOver: e => e.preventDefault(),
      onDrop: onDropToAvailable,
      onTouchEnd: onDropToAvailable,
      style: { display: "flex", flexWrap: "wrap", gap: "15px", marginTop: "20px", alignItems: "flex-start" }
    }, availableItems.map(renderItem)),

    React.createElement("div", {
      onDragOver: e => e.preventDefault(),
      onDrop: onDropToKnapsack,
      onTouchEnd: onDropToKnapsack,
      style: { marginTop: "30px", padding: "15px", border: "2px dashed #ccc", borderRadius: "10px", backgroundColor: "#f9fafb" }
    },
      React.createElement("h3", null, "🧺 Items in Knapsack"),
      selectedItems.length === 0
        ? React.createElement("p", null, "No items selected.")
        : React.createElement("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px", alignItems: "flex-start" } }, selectedItems.map(renderItem))
    ),

    React.createElement("div", { style: { marginTop: "30px" } },
      React.createElement("p", null, `🎯 Target Value: $${TARGET_VALUE}`),
      React.createElement("p", null, `🧮 Current Value: $${currentValue}`),
      React.createElement("p", null, `⚖️ Current Weight: ${currentWeight} Kg`),
      React.createElement("p", null, `➕ Weight Left: ${weightLeft} Kg`),
      quit && React.createElement("p", { style: { color: "red", fontWeight: "bold" } }, "🚨 You quit!")
    ),

    React.createElement("div", { style: { marginTop: "30px" } },
      React.createElement("button", {
        onClick: () => {
          setQuit(true);
          sendToSheet();
          alert("✅ Your data was submitted to Google Sheets!");
        },
        style: { padding: "12px 20px", fontSize: "16px", marginRight: "12px", borderRadius: "8px", border: "none", cursor: "pointer", backgroundColor: "#ef4444", color: "#fff" }
      }, "❌ Quit"),
      React.createElement("button", {
        onClick: () => {
          sendToSheet();
          setRound(prev => prev + 1);
        },
        style: { padding: "12px 20px", fontSize: "16px", borderRadius: "8px", border: "none", cursor: "pointer", backgroundColor: "#3b82f6", color: "#fff" }
      }, "➡️ Next Round")
    )
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(KnapsackGame));

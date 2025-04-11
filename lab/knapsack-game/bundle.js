
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
const RISK_LEVELS = [0, 0.2, 0.4];
const VISIBILITY_MODES = ["Daylight", "Darkness", "Silent"];

function KnapsackGame() {
  const [round, setRound] = React.useState(0);
  const [selectedItems, setSelectedItems] = React.useState([]);
  const [visibility, setVisibility] = React.useState(VISIBILITY_MODES[0]);
  const [risk, setRisk] = React.useState(RISK_LEVELS[0]);
  const [showOpponent, setShowOpponent] = React.useState(true);
  const [opponentProgress, setOpponentProgress] = React.useState([]);
  const [quit, setQuit] = React.useState(false);

  React.useEffect(() => {
    if (visibility === "Daylight") {
      const interval = setInterval(() => {
        const randItem = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        setOpponentProgress((prev) => [...prev, randItem]);
      }, 1500);
      return () => clearInterval(interval);
    } else if (visibility === "Silent") {
      const timeout = setTimeout(() => {
        setShowOpponent(true);
        const progress = Array.from({ length: 4 }, () => ITEMS[Math.floor(Math.random() * ITEMS.length)]);
        setOpponentProgress(progress);
      }, 10000);
      return () => clearTimeout(timeout);
    } else {
      setShowOpponent(false);
    }
  }, [visibility, round]);

  const currentWeight = selectedItems.reduce((acc, item) => acc + item.weight, 0);
  const currentValue = selectedItems.reduce((acc, item) => acc + item.value, 0);
  const weightLeft = MAX_WEIGHT - currentWeight;

  const handleSelect = (item) => {
    if (currentWeight + item.weight <= MAX_WEIGHT && !selectedItems.includes(item)) {
      setSelectedItems([...selectedItems, item]);
    }
  };

  const handleQuit = () => setQuit(true);

  const nextRound = () => {
    const next = round + 1;
    setRound(next);
    setSelectedItems([]);
    setOpponentProgress([]);
    setQuit(false);
    setRisk(RISK_LEVELS[next % RISK_LEVELS.length]);
    setVisibility(VISIBILITY_MODES[next % VISIBILITY_MODES.length]);
  };

  const containerStyle = {
    padding: "30px",
    fontFamily: "'Segoe UI', 'Inter', sans-serif",
    maxWidth: "900px",
    margin: "auto",
  };

  const itemStyle = (selected) => ({
    border: selected ? "2px solid #3b82f6" : "1px solid #ccc",
    borderRadius: "12px",
    padding: "10px",
    cursor: "pointer",
    textAlign: "center",
    backgroundColor: selected ? "#e0f2fe" : "#fff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    transition: "all 0.2s",
  });

  const buttonStyle = {
    padding: "12px 20px",
    fontSize: "16px",
    marginRight: "12px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    backgroundColor: "#3b82f6",
    color: "#fff",
    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
  };

  return React.createElement("div", { style: containerStyle },
    React.createElement("h1", { style: { fontSize: "28px", marginBottom: "10px" } }, "🎒 Knapsack Contest Game"),
    React.createElement("p", null, `Round: ${round + 1}`),
    React.createElement("p", null, `Visibility Mode: ${visibility}`),
    React.createElement("p", null, `Infeasibility Risk: ${risk * 100}%`),

    React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: "15px",
        marginTop: "20px",
      }
    },
      ITEMS.map(item =>
        React.createElement("div", {
          key: item.id,
          onClick: () => handleSelect(item),
          style: itemStyle(selectedItems.includes(item)),
        }, [
          React.createElement("p", { key: "v", style: { margin: 0, fontWeight: "bold" } }, `$${item.value}`),
          React.createElement("p", { key: "w", style: { margin: 0 } }, `${item.weight} Kg`)
        ])
      )
    ),

    React.createElement("div", { style: { marginTop: "30px" } },
      React.createElement("p", null, `🎯 Target Value: $${TARGET_VALUE}`),
      React.createElement("p", null, `🧮 Current Value: $${currentValue}`),
      React.createElement("p", null, `⚖️ Current Weight: ${currentWeight} Kg`),
      React.createElement("p", null, `➕ Weight Left: ${weightLeft} Kg`),
      quit && React.createElement("p", { style: { color: "red", fontWeight: "bold" } }, "🚨 You quit!")
    ),

    visibility !== "Darkness" && showOpponent && React.createElement("div", { style: { marginTop: "30px" } },
      React.createElement("h2", null, "👤 Opponent's Progress"),
      React.createElement("div", {
        style: {
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          marginTop: "10px",
        }
      },
        opponentProgress.map((item, i) =>
          React.createElement("div", {
            key: i,
            style: {
              border: "1px solid #aaa",
              padding: "8px",
              borderRadius: "8px",
              backgroundColor: "#f3f4f6",
              fontSize: "14px",
            }
          }, `$${item.value} / ${item.weight}Kg`)
        )
      )
    ),

    React.createElement("div", { style: { marginTop: "30px" } },
      React.createElement("button", {
        onClick: handleQuit,
        style: { ...buttonStyle, backgroundColor: "#ef4444" }
      }, "❌ Quit"),
      React.createElement("button", {
        onClick: nextRound,
        style: buttonStyle
      }, "➡️ Next Round")
    )
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(KnapsackGame));

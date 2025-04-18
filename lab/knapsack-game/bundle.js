// Browser-compatible Knapsack Game without imports or TypeScript
const generateRandomItems = (count) => {
  const names = ["Gold Coin", "Silver Coin", "Diamond", "Potion", "Scroll", "Ruby", "Map", "Ring", "Lantern", "Elixir"];
  return Array.from({ length: count }, (_, i) => {
    const weight = Math.floor(Math.random() * 9) + 1;
    const value = Math.floor(Math.random() * 31) + 1;
    return {
      id: i + 1,
      name: names[i % names.length],
      weight,
      value
    };
  });
};

const generateFeasibleRound = () => {
  let feasibleSubset = null;
  let items = [];
  let optimalValue = 0;
  let totalWeightConstraint = 0;
  let attempts = 0;

  const findFeasibleSubset = (candidates, target, maxWeight, minItems) => {
    const allCombos = (arr, k) => {
      if (k === 0) return [[]];
      if (arr.length === 0) return [];
      const [first, ...rest] = arr;
      const withFirst = allCombos(rest, k - 1).map(combo => [first, ...combo]);
      const withoutFirst = allCombos(rest, k);
      return [...withFirst, ...withoutFirst];
    };
    for (let r = minItems; r <= candidates.length; r++) {
      const combos = allCombos(candidates, r);
      for (const combo of combos) {
        const val = combo.reduce((acc, item) => acc + item.value, 0);
        const wt = combo.reduce((acc, item) => acc + item.weight, 0);
        if (val === target && wt <= maxWeight) return combo;
      }
    }
    return null;
  };

  while (!feasibleSubset && attempts < 1000) {
    optimalValue = Math.floor(Math.random() * 8) + 18;
    totalWeightConstraint = Math.floor(Math.random() * 16) + 20;
    const numberOfItems = Math.floor(Math.random() * 4) + 9;
    items = generateRandomItems(numberOfItems);
    feasibleSubset = findFeasibleSubset(items, optimalValue, totalWeightConstraint, 4);
    attempts++;
  }

  return { items, optimalValue, totalWeightConstraint };
};

const App = () => {
  const [items, setItems] = React.useState([]);
  const [selected, setSelected] = React.useState([]);
  const [capacity, setCapacity] = React.useState(30);
  const [optimalValue, setOptimalValue] = React.useState(0);

  React.useEffect(() => {
    const roundData = generateFeasibleRound();
    if (roundData && Array.isArray(roundData.items)) {
      const cleanedItems = roundData.items.filter(item => typeof item === 'object' && item !== null && 'id' in item && 'value' in item && 'weight' in item && 'name' in item);
      setItems(cleanedItems);
      setOptimalValue(Number.isFinite(roundData.optimalValue) ? roundData.optimalValue : 0);
      setCapacity(Number.isFinite(roundData.totalWeightConstraint) ? roundData.totalWeightConstraint : 30);
    }
  }, []);

  const totalWeight = Array.isArray(selected) ? selected.reduce((sum, i) => sum + i.weight, 0) : 0;
  const totalValue = Array.isArray(selected) ? selected.reduce((sum, i) => sum + i.value, 0) : 0;

  const onDrop = (e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/json");
    if (!data) return;
    try {
      const item = JSON.parse(data);
      if (
        item && typeof item === 'object' &&
        'id' in item && 'weight' in item && 'value' in item && 'name' in item &&
        Array.isArray(selected) &&
        !selected.find(i => i.id === item.id) &&
        totalWeight + item.weight <= capacity
      ) {
        setSelected(prev => [...prev, item]);
        setItems(prev => Array.isArray(prev) ? prev.filter(i => i.id !== item.id) : []);
      }
    } catch (err) {
      console.error("Invalid drop item format", err);
    }
  };

  return React.createElement("div", { className: "p-6" },
    React.createElement("h1", { className: "text-2xl font-bold mb-4" }, "🎒 Knapsack Game"),
    React.createElement("p", null, `🎯 Target Value: $${optimalValue}`),
    React.createElement("p", null, `⚖️ Total Weight: ${totalWeight} / ${capacity} kg`),
    React.createElement("p", null, `💰 Total Value: $${totalValue}`),

    React.createElement("h2", { className: "mt-4 font-semibold" }, "Available Items"),
    Array.isArray(items) && React.createElement("div", { className: "grid grid-cols-2 md:grid-cols-3 gap-2" },
      items.map(item =>
        React.createElement("div", {
          key: item.id,
          className: "border rounded bg-white p-3 text-sm",
          draggable: true,
          onDragStart: (e) => e.dataTransfer.setData("application/json", JSON.stringify(item))
        },
          React.createElement("strong", null, item.name),
          React.createElement("p", null, `💰 $${item.value}`),
          React.createElement("p", null, `⚖️ ${item.weight} kg`)
        )
      )
    ),

    React.createElement("h2", { className: "mt-6 font-semibold" }, "Knapsack"),
    React.createElement("div", {
      onDragOver: (e) => e.preventDefault(),
      onDrop,
      className: "min-h-[100px] p-4 bg-green-100 border rounded mt-2"
    },
      Array.isArray(selected) && selected.length === 0
        ? React.createElement("p", null, "Drop items here")
        : selected.map(item =>
          React.createElement("div", { key: item.id, className: "text-sm bg-white p-2 rounded mb-1" },
            `${item.name} - $${item.value}, ${item.weight} kg`
          )
        )
    )
  );
};

window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("root");
  if (container && window.ReactDOM) {
    window.ReactDOM.createRoot(container).render(React.createElement(App));
  } else {
    console.error("❌ ReactDOM is not defined or root element is missing. Ensure React and ReactDOM scripts are loaded.");
  }
});

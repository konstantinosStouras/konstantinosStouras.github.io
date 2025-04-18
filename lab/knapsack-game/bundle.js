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

const ItemCard = ({ item }) => (
  React.createElement("div", {
    className: "border p-4 mb-3 rounded-2xl cursor-move bg-white",
    draggable: true,
    onDragStart: (e) => e.dataTransfer.setData("application/json", JSON.stringify(item))
  },
    React.createElement("h4", { className: "font-semibold text-lg" }, item.name),
    React.createElement("p", { className: "text-sm text-gray-600" }, `Weight: ${item.weight} kg`),
    React.createElement("p", { className: "text-sm text-gray-600" }, `Value: $${item.value}`)
  )
);

const App = () => {
  return React.createElement("div", { className: "text-center p-4" }, "Knapsack Game will render here");
};

if (document.readyState === "complete" || document.readyState === "interactive") {
  const container = document.getElementById("root");
  if (container) {
    ReactDOM.createRoot(container).render(React.createElement(App));
  } else {
    console.error("❌ Could not find root element in HTML. Make sure your index.html contains <div id=\"root\"></div>");
  }
} else {
  window.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("root");
    if (container) {
      ReactDOM.createRoot(container).render(React.createElement(App));
    } else {
      console.error("❌ Could not find root element in HTML. Make sure your index.html contains <div id=\"root\"></div>");
    }
  });
}

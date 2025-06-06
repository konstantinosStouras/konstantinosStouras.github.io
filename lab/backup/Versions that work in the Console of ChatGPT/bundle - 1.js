// Full Knapsack Game React App Preview
import React, { useState, useEffect } from "react";

interface Item {
  id: number;
  name: string;
  weight: number;
  value: number;
}

const generateRandomItems = (count: number): Item[] => {
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
  let feasibleSubset: Item[] | null = null;
  let items: Item[] = [];
  let optimalValue = 0;
  let totalWeightConstraint = 0;
  let attempts = 0;

  const findFeasibleSubset = (candidates: Item[], target: number, maxWeight: number, minItems: number) => {
    const allCombos = (arr: Item[], k: number): Item[][] => {
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

const CAPACITY = 10;

const ItemCard = ({ item }: { item: Item }) => (
  <div
    className="border p-4 mb-3 rounded-2xl cursor-move bg-white"
    draggable
    onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify(item))}
  >
    <h4 className="font-semibold text-lg">{item.name}</h4>
    <p className="text-sm text-gray-600">Weight: {item.weight} kg</p>
    <p className="text-sm text-gray-600">Value: ${item.value}</p>
  </div>
);

const MiniItem = ({ item, onRemove }: { item: Item; onRemove: (id: number) => void }) => (
  <div className="border p-3 rounded bg-white text-sm mb-2">
    <div className="flex justify-between">
      <span>{item.name}</span>
      <button className="text-red-500" onClick={() => onRemove(item.id)}>✖</button>
    </div>
    <p className="text-xs">Weight: {item.weight} kg</p>
    <p className="text-xs">Value: ${item.value}</p>
  </div>
);

const Knapsack = ({
  items = [],
  onDropItem,
  onRemove,
  totalWeight,
  capacity
}: {
  items?: Item[];
  onDropItem: (item: Item) => void;
  onRemove: (id: number) => void;
  totalWeight: number;
  capacity: number;
}) => {
  return (
    <div
      className="border p-4 rounded min-h-[200px] bg-green-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const data = e.dataTransfer.getData("application/json");
        if (data) {
          try {
            const item: Item = JSON.parse(data);
            onDropItem(item);
          } catch {
            console.error("Invalid drop item");
          }
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2">
        {(items || []).map((item) => (
          <MiniItem key={item.id} item={item} onRemove={onRemove} />
        ))}
      </div>
      <p className="text-sm mt-2">Total Weight: {totalWeight} kg / {capacity} kg</p>
    </div>
  );
};

const App = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item[]>([]);
  const [capacity, setCapacity] = useState<number>(CAPACITY);
  const [optimalValue, setOptimalValue] = useState<number>(0);
  const [round, setRound] = useState(1);
  const [quit, setQuit] = useState(false);
  const [history, setHistory] = useState<{ value: number; weight: number; optimal: number; target: number; capacity: number; round: number; duration: number }[]>([]);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    fetch("https://ipapi.co/json")
      .then(res => res.json())
      .then(data => window.geoInfo = { city: data.city, country: data.country_name })
      .catch(() => window.geoInfo = { city: "", country: "" });
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const totalWeight = selected.reduce((sum, item) => sum + item.weight, 0);

  const startRound = () => {
    const roundData = generateFeasibleRound();
    setItems(roundData.items);
    setOptimalValue(roundData.optimalValue);
    setCapacity(roundData.totalWeightConstraint);
    setSelected([]);
    setStartTime(Date.now());
  };

  useEffect(() => {
    startRound();
  }, []);

  const handleDrop = (item: Item) => {
    if (!selected.find(i => i.id === item.id) && totalWeight + item.weight <= capacity) {
      setSelected(prev => [...prev, item]);
      setItems(prev => prev.filter(i => i.id !== item.id));
    }
  };

  const handleRemove = (id: number) => {
    const removedItem = selected.find(i => i.id === id);
    if (removedItem) {
      setSelected(prev => prev.filter(i => i.id !== id));
      setItems(prev => [...prev, removedItem]);
    }
  };

  if (quit) {
    const totalRounds = history.length;
    const percentOptimal = ((history.filter(r => r.optimal).length / totalRounds) * 100).toFixed(0);
    const averageTime = history.reduce((sum, r) => sum + r.duration, 0) / totalRounds;
    return (
      <div className="p-4 bg-white max-w-full sm:max-w-xl mx-auto mt-10 rounded shadow">
        <h2 className="text-xl font-bold mb-4">Game Summary</h2>
        <ul className="mb-4">
          {history.map((r, i) => (
            <li key={i} className={`text-sm mb-1 ${r.optimal ? 'bg-yellow-200' : ''}`}>
              <strong>Round {r.round}</strong>: Value ${r.value}, Target ${r.target}, Weight {r.weight}kg / {r.capacity}kg – {r.optimal ? "Optimal" : "Not Optimal"}, Time: {Math.floor(r.duration / 3600)}h {Math.floor((r.duration % 3600) / 60)}min {r.duration % 60}sec
            </li>
          ))}
        </ul>
        <p className="text-sm font-semibold">Success Rate: {percentOptimal}%</p>
        <p className="text-sm font-semibold">Average Time: {`${Math.floor(averageTime / 3600)}h ${Math.floor((averageTime % 3600) / 60)}min ${Math.floor(averageTime % 60)}sec`}</p>
        <button
          onClick={() => {
            setQuit(false);
            setHistory([]);
            setRound(1);
            startRound();
          }}
          className="mt-4 px-4 py-2 bg-green-500 text-white rounded"
        >
          Play Again
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-100 to-green-100 p-6">
      <h1 className="text-3xl font-bold text-center mb-4">Knapsack Game</h1>
      <h2 className="text-lg text-center mb-6">Round {round}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-full md:max-w-6xl mx-auto items-start px-2">
        <div>
          <h2 className="text-xl font-bold mb-2">Available Items</h2>
          <div className="grid grid-cols-2 gap-2">
            {items.map(item => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2">Knapsack</h2>
          <Knapsack
            items={selected}
            onDropItem={handleDrop}
            onRemove={handleRemove}
            totalWeight={totalWeight}
            capacity={capacity}
          />
        </div>
        <div className="border rounded p-2 bg-white shadow w-full md:max-w-xs">
          <h2 className="text-lg font-semibold mb-2">Stats</h2>
          <p>Total Value: ${selected.reduce((sum, i) => sum + i.value, 0)}</p>
          <p>Total Weight: {totalWeight} kg / {capacity} kg</p>
          <p>Target Value: ${optimalValue}</p>
          <p>Time: {Math.floor(elapsedTime / 3600)}h {Math.floor((elapsedTime % 3600) / 60)}min {elapsedTime % 60}sec</p>
          <button
            onClick={() => {
              setHistory(prev => [...prev, {
                value: selected.reduce((sum, i) => sum + i.value, 0),
                duration: elapsedTime,
                weight: totalWeight,
                optimal: selected.reduce((sum, i) => sum + i.value, 0) === optimalValue ? 1 : 0,
                target: optimalValue,
                capacity,
                round
              }]);
              setRound(prev => prev + 1);
              startRound();
            }}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded mr-2"
          >
            Next Round
          </button>
          <button
            onClick={() => {
              setHistory(prev => [...prev, {
                value: selected.reduce((sum, i) => sum + i.value, 0),
                duration: elapsedTime,
                weight: totalWeight,
                optimal: selected.reduce((sum, i) => sum + i.value, 0) === optimalValue ? 1 : 0,
                target: optimalValue,
                capacity,
                round
              }]);
              fetch("https://knapsack-proxy.vercel.app/api/submit", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  sessionId: localStorage.getItem("knapsack_session") || (() => {
                    const id = crypto.randomUUID();
                    localStorage.setItem("knapsack_session", id);
                    return id;
                  })(),
                  timestamp: new Date().toISOString(),
                  summary: history.map(r => {
                    const ua = navigator.userAgent;
                    const match = ua.match(/(Chrome|Firefox|Safari|Edg|OPR|Trident)\/([\d\.]+)/);
                    const browser = match ? `${match[1]} ${match[2]}` : "Unknown Browser";
                    return {
                      round: r.round,
                      value: r.value,
                      weight: r.weight,
                      optimal: r.optimal,
                      target: r.target,
                      capacity: r.capacity,
                      duration: r.duration,
                      city: window.geoInfo?.city || "",
                      country: window.geoInfo?.country || "",
                      device: navigator.userAgentData ? (navigator.userAgentData.mobile ? "Mobile" : "Desktop") : "Unknown",
                      browser
                    };
                  })
                })
              }).then(() => setQuit(true)).catch((err) => {
                console.error("Logging to Google Sheets failed:", err);
                setQuit(true);
              });
            }}
            className="mt-4 px-4 py-2 bg-red-500 text-white rounded"
          >
            Quit
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;

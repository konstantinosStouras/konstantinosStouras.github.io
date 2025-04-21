import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const NUM_ITEMS = 6;
const VECTOR_DIM = 5;

const randomVector = (baseVector = null, noise = 2) => {
  if (!baseVector) return Array.from({ length: VECTOR_DIM }, () => Math.random() * 10);
  return baseVector.map(v => Math.max(0, Math.min(10, v + (Math.random() * noise * 2 - noise))));
};

const cosineSimilarity = (a, b) => {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val ** 2, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val ** 2, 0));
  return dot / (magA * magB);
};

const averageSimilarity = (items) => {
  let sum = 0, count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      sum += cosineSimilarity(items[i].attributes, items[j].attributes);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
};

const getAllSubsets = (items) => {
  const subsets = [];
  const n = items.length;
  for (let i = 1; i < 1 << n; i++) {
    const subset = [];
    for (let j = 0; j < n; j++) {
      if (i & (1 << j)) subset.push(items[j]);
    }
    subsets.push(subset);
  }
  return subsets;
};

const generateItemsAndThreshold = () => {
  const baseVector = randomVector();
  const shuffledIndices = [...Array(NUM_ITEMS).keys()].sort(() => 0.5 - Math.random());
  const similarIndices = new Set(shuffledIndices.slice(0, 3));
  const items = Array.from({ length: NUM_ITEMS }, (_, i) => {
    const isSimilar = similarIndices.has(i);
    const vector = isSimilar
      ? randomVector(baseVector, 1)
      : randomVector(randomVector(), 5);
    return {
      id: `item-${i}`,
      name: `Item ${i + 1}`,
      value: Math.floor(Math.random() * 100),
      attributes: isSimilar && i === Math.min(...similarIndices) ? baseVector : vector,
    };
  });
  const subsets = getAllSubsets(items);
  let maxSimWith3 = 0;
  for (const subset of subsets) {
    if (subset.length === 3) {
      const sim = averageSimilarity(subset);
      if (sim > maxSimWith3) maxSimWith3 = sim;
    }
  }
  return { items, similarityThreshold: Number(maxSimWith3.toFixed(4)) };
};

const findOptimalSubset = (items, threshold) => {
  const subsets = getAllSubsets(items);
  let best = { value: 0, subset: [] };
  for (const subset of subsets) {
    const sim = averageSimilarity(subset);
    const value = subset.reduce((sum, item) => sum + item.value, 0);
    if (sim >= threshold && value > best.value) {
      best = { value, subset };
    }
  }
  return best;
};

export default function CosineKnapsackGame() {
  const [{ items, similarityThreshold }, setRoundData] = useState(generateItemsAndThreshold);
  const [round, setRound] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [optimalIds, setOptimalIds] = useState([]);
  const [optimalStats, setOptimalStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [quit, setQuit] = useState(false);

  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const totalValue = selectedItems.reduce((sum, item) => sum + item.value, 0);
  const similarity = averageSimilarity(selectedItems);
  const success = similarity >= similarityThreshold;

  const toggleItem = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const nextRound = () => {
    setHistory((prev) => [...prev, { round, success }]);
    setRound((prev) => prev + 1);
    const newRound = generateItemsAndThreshold();
    setRoundData(newRound);
    setSelectedIds([]);
    setOptimalIds([]);
    setOptimalStats(null);
  };

  const quitGame = () => {
    setHistory((prev) => [...prev, { round, success }]);
    setQuit(true);
  };

  const showOptimal = () => {
    const result = findOptimalSubset(items, similarityThreshold);
    const ids = result.subset.map((item) => item.id);
    setOptimalIds(ids);
    setSelectedIds(ids);
    const allSubsets = getAllSubsets(items)
      .filter(sub => sub.length >= 2)
      .map(subset => ({
        names: subset.map(item => item.name).join(', '),
        value: subset.reduce((sum, item) => sum + item.value, 0),
        similarity: averageSimilarity(subset),
        valid: averageSimilarity(subset) >= similarityThreshold
      }))
      .sort((a, b) => b.value - a.value);

    setOptimalStats({
      value: result.value,
      similarity: averageSimilarity(result.subset),
      items: result.subset,
      allSubsets
    });
  };

  if (quit) {
    const total = history.length;
    const passed = history.filter(h => h.success).length;
    const rate = ((passed / total) * 100).toFixed(1);
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-3xl font-bold">Session Summary</h1>
        <p className="text-lg">You played {total} round(s).</p>
        <table className="w-full text-sm table-auto border-collapse border border-gray-300">
          <thead className="bg-gray-100">
            <tr>
              <th className="border p-2">Round</th>
              <th className="border p-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {history.map(({ round, success }, idx) => (
              <tr key={idx} className={success ? "bg-green-100 font-semibold" : ""}>
                <td className="border p-2">{round}</td>
                <td className="border p-2">{success ? "✅ Success" : "❌ Failed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-lg mt-4">Average Success Rate: {rate}%</p>
        <Button className="mt-4" onClick={() => {
          setRound(1);
          setSelectedIds([]);
          setOptimalIds([]);
          setOptimalStats(null);
          setHistory([]);
          setRoundData(generateItemsAndThreshold());
          setQuit(false);
        }}>
          Play Again
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">Knapsack with Dependencies</h1>
      <h2 className="text-xl font-semibold">Round {round}</h2>
      <p className="text-md">
        Select a group of items that maximizes total value,<br />
        subject to: Average Cosine Similarity ≥ {similarityThreshold} (range: -1 to 1)
      </p>

      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-2 gap-4">
        {items.map((item) => (
          <Card
            key={item.id}
            onClick={() => toggleItem(item.id)}
            className={`cursor-pointer transition-all duration-200 border-2 ${
              selectedIds.includes(item.id) ? "border-blue-500" : "border-transparent"
            }`}
          >
            <CardContent className="p-4">
              <div className="font-semibold">{item.name}</div>
              <div>Value: {item.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="p-4 border rounded-lg space-y-2">
        <h2 className="text-xl font-semibold mb-2">Stats</h2>
        <p>Total Value: {totalValue}</p>
        <p>Target Cosine Similarity: {similarityThreshold}</p>
        <p>
          Avg Cosine Similarity: {similarity.toFixed(3)} (
          {success ? "✅ Pass" : "❌ Fail"})
        </p>
        <div className="flex space-x-4 pt-4">
          <Button onClick={nextRound}>Next Round</Button>
          <Button variant="outline" onClick={quitGame}>Quit</Button>
          <Button variant="secondary" onClick={showOptimal}>Show Optimal</Button>
        </div>
      </div>

      {optimalStats && (
        <>
          <div className="p-4 mt-6 border rounded-lg bg-gray-50 space-y-2">
            <h2 className="text-xl font-semibold mb-2">Optimal Solution</h2>
            <ul className="list-disc list-inside">
              {optimalStats.items.map((item) => (
                <li key={item.id}>
                  {item.name} (Value: {item.value})<br />
                  Vector: [{item.attributes.map((v) => v.toFixed(2)).join(", ")}]
                </li>
              ))}
            </ul>
            <p>Total Optimal Value: {optimalStats.value}</p>
            <p>Avg Cosine Similarity: {optimalStats.similarity.toFixed(3)}</p>
          </div>

          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-2">All Valid Subsets (2+ items)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {optimalStats.allSubsets.map((sub, idx) => (
                <div
                  key={idx}
                  className={`p-3 border rounded-lg ${sub.valid ? 'bg-green-50' : 'bg-red-50'}`}
                >
                  <div className="font-medium">{sub.names}</div>
                  <div>Value: {sub.value}</div>
                  <div>Similarity: {sub.similarity.toFixed(3)} {sub.valid ? '✅' : '❌'}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

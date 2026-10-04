const handler = require("./api/mcp");

function call(body) {
  return new Promise((resolve) => {
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve(o); },
      end() { resolve({ status: this.code }); },
    };
    handler({ method: "POST", headers: {}, body }, res);
  });
}

(async () => {
  const l = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  console.log(l.result.tools.map((t) => t.name));
  for (const name of ["find_hotel_deals", "search_hotels"]) {
    const r = await call({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: {
        name,
        arguments: {
          query: "hotels in Goa",
          check_in_date: "2026-10-10",
          check_out_date: "2026-10-13",
          limit: 3,
        },
      },
    });
    const t = r.result.content[0].text;
    if (r.result.isError) { console.log(name, t); continue; }
    const d = JSON.parse(t);
    console.log(name, "found", d.total_found, "deals", d.deals_found, "cheapest", d.cheapest?.name, d.cheapest?.price_per_night);
    for (const h of d.hotels) console.log(" ", h.name, h.price_per_night, h.total_price, h.overall_rating, h.deal || "");
  }
  const bad = await call({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "search_hotels", arguments: { query: "x", check_in_date: "2026-10-10", check_out_date: "2026-10-09" } },
  });
  console.log(bad.result.content[0].text);
})();

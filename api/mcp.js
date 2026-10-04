// Stateless MCP server (Streamable HTTP, JSON responses) for Vercel.
const { searchHotels, getHotelDetails, getHotelPhotos, getHotelReviews } = require("./hotels");

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "hotel-details-mcp", version: "1.0.0" };

const props = {
  query: {
    type: "string",
    description: "Where to stay, e.g. 'hotels in Goa' or 'Candolim Goa' or a hotel name",
  },
  check_in_date: { type: "string", description: "Check-in date, YYYY-MM-DD" },
  check_out_date: { type: "string", description: "Check-out date, YYYY-MM-DD" },
  adults: { type: "integer", description: "Number of adults, default 2" },
  children: { type: "integer", description: "Number of children, default 0" },
  min_price: { type: "integer", description: "Minimum price per night (INR)" },
  max_price: { type: "integer", description: "Maximum price per night (INR)" },
  rating: {
    type: "integer",
    description: "Minimum guest rating: 7 = 3.5+, 8 = 4.0+, 9 = 4.5+",
  },
  hotel_class: {
    type: "string",
    description: "Star class, comma-separated, e.g. '3,4' for 3 and 4 star",
  },
  free_cancellation: { type: "boolean", description: "Only hotels with free cancellation" },
  limit: { type: "integer", description: "Max hotels to return (1-20, default 5)" },
};

const required = ["query", "check_in_date", "check_out_date"];

const propertyProps = {
  property_token: {
    type: "string",
    description: "property_token of the hotel, from search_hotels / find_hotel_deals results",
  },
  query: { type: "string", description: "The same destination or hotel name used in the search" },
  check_in_date: props.check_in_date,
  check_out_date: props.check_out_date,
  adults: props.adults,
};
const propertyRequired = ["property_token", "query", "check_in_date", "check_out_date"];

const TOOLS = [
  {
    name: "find_hotel_deals",
    description:
      "Find hotels with deals and the lowest prices for a destination and dates. Prices are in INR. Returns only hotels that Google flags as a deal (with discount text) and, separately, the cheapest hotel overall.",
    inputSchema: { type: "object", properties: props, required },
    handler: (a) => searchHotels({ ...a, sort_by: 3, only_deals: true }),
  },
  {
    name: "search_hotels",
    description:
      "Search hotels for a destination and dates with price per night, total price, rating, class, amenities and nearby places (prices in INR). Use find_hotel_deals when the goal is discounted or cheapest stays.",
    inputSchema: {
      type: "object",
      properties: {
        ...props,
        sort_by: {
          type: "integer",
          description: "3 = Lowest price (default), 8 = Highest rating, 13 = Most reviewed",
        },
      },
      required,
    },
    handler: (a) => searchHotels(a),
  },
  {
    name: "get_hotel_details",
    description:
      "Get full details for one hotel: description, address, phone, amenities, check-in/out times, nearby places, ratings and prices from booking sites (INR). Needs the property_token returned by search_hotels or find_hotel_deals.",
    inputSchema: { type: "object", properties: propertyProps, required: propertyRequired },
    handler: (a) => getHotelDetails(a),
  },
  {
    name: "get_hotel_photos",
    description:
      "Get photo URLs (thumbnail and original) for one hotel. Needs the property_token returned by search_hotels or find_hotel_deals.",
    inputSchema: {
      type: "object",
      properties: {
        ...propertyProps,
        limit: { type: "integer", description: "Max photos to return (1-50, default 10)" },
      },
      required: propertyRequired,
    },
    handler: (a) => getHotelPhotos(a),
  },
  {
    name: "get_hotel_reviews",
    description:
      "Get guest reviews for one hotel (author, rating, date, text) plus the rating breakdown. Needs the property_token returned by search_hotels or find_hotel_deals. Use next_page_token from a previous call to get more.",
    inputSchema: {
      type: "object",
      properties: {
        property_token: propertyProps.property_token,
        sort_by: {
          type: "integer",
          description: "1 = Most helpful, 2 = Most recent, 3 = Highest score, 4 = Lowest score",
        },
        limit: { type: "integer", description: "Max reviews to return (1-20, default 10)" },
        next_page_token: { type: "string", description: "Token from a previous call for the next page" },
      },
      required: ["property_token"],
    },
    handler: (a) => getHotelReviews(a),
  },
];

function validate(args, tool) {
  const req = tool.inputSchema.required || [];
  const missing = req.filter((k) => !args[k]);
  if (missing.length) return `Missing required argument(s): ${missing.join(", ")}`;
  if (req.includes("check_in_date")) {
    for (const k of ["check_in_date", "check_out_date"]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args[k])) return `${k} must be YYYY-MM-DD`;
    }
    if (args.check_out_date <= args.check_in_date) return "check_out_date must be after check_in_date";
  }
  return null;
}

async function handleRpc(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ handler, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
      const args = params.arguments || {};
      const problem = validate(args, tool);
      if (problem) return ok({ isError: true, content: [{ type: "text", text: problem }] });
      try {
        const result = await tool.handler(args);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return ok({
          isError: true,
          content: [{ type: "text", text: `Hotel search failed: ${e.message}` }],
        });
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const token = process.env.MCP_AUTH_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    // Health check; no server-initiated SSE stream in stateless mode.
    if ((req.headers.accept || "").includes("text/event-stream")) return res.status(405).end();
    return res.status(200).json({ ...SERVER_INFO, status: "ok", tools: TOOLS.map((t) => t.name) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return res
      .status(400)
      .json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  const responses = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object" || !m.method) continue;
    if (m.id === undefined) continue; // notification, no response
    responses.push(await handleRpc(m));
  }
  if (!responses.length) return res.status(202).end();
  return res.status(200).json(batch ? responses : responses[0]);
};

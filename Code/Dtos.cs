using System.Collections.Generic;

namespace SpireScryer;

public class StateDto
{
    public bool inRun { get; set; }
    public long timestamp { get; set; }
    public int? ascension { get; set; }
    public int? act { get; set; }
    public int? floor { get; set; }
    public List<PlayerDto> players { get; set; } = new();
}

public class PlayerDto
{
    public ulong netId { get; set; }
    public string character { get; set; } = "";
    public int currentHp { get; set; }
    public int maxHp { get; set; }
    public int gold { get; set; }
    public int maxEnergy { get; set; }

    public List<CardDto> deck { get; set; } = new();
    public List<RelicDto> relics { get; set; } = new();
    public List<PotionDto?> potionSlots { get; set; } = new();

    public CombatDto? combat { get; set; }
}

public class CombatDto
{
    public int energy { get; set; }
    public int maxEnergy { get; set; }
    public int block { get; set; }
    public List<CardDto> hand { get; set; } = new();
    public List<CardDto> drawPile { get; set; } = new();
    public List<CardDto> discardPile { get; set; } = new();
    public List<CardDto> exhaustPile { get; set; } = new();
    public List<PowerDto> powers { get; set; } = new();
}

public class CardDto
{
    public string id { get; set; } = "";
    public string title { get; set; } = "";
    public string description { get; set; } = "";
    public string type { get; set; } = "";
    public string rarity { get; set; } = "";
    public string character { get; set; } = "";
    public int cost { get; set; }
    public bool costX { get; set; }
    public int upgradeLevel { get; set; }
    public bool isUpgraded { get; set; }
}

public class RelicDto
{
    public string id { get; set; } = "";
    public string title { get; set; } = "";
    public string description { get; set; } = "";
    public string rarity { get; set; } = "";
    public int stackCount { get; set; }
}

public class PotionDto
{
    public string id { get; set; } = "";
    public string title { get; set; } = "";
    public string description { get; set; } = "";
    public string rarity { get; set; } = "";
}

public class PowerDto
{
    public string id { get; set; } = "";
    public string type { get; set; } = "";
    public int amount { get; set; }
}

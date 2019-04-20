import {Container, Service} from "typedi";
import {Connection} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {Genre} from "../../entity/Genre";
import {MetaData} from "../../entity/MetaData";
import MediaController from "../controllers/MediaController";

@Service()
export class GenreRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public getAllGenres() {
        const userRepo = this.connection.manager.getRepository(Genre);
        return userRepo.find();
    }

    public async reprocessAllGenres() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        const allMeta = await metaRepo.find();
        let allGenres: string[] = [];
        if (allMeta) {
            for (const meta of allMeta) {
                if (meta && meta.genres) {
                    const genres = meta.genres.split(", ") as string[];
                    if (genres) {
                        allGenres = allGenres.concat(genres);
                    }
                }
            }
        }
        return Container.get(MediaController).addGenres(allGenres);
    }
}

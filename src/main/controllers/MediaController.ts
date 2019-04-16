import {Service} from "typedi";
import {InjectConnection} from "typeorm-typedi-extensions";
import {Connection, In, Not} from "typeorm";
import * as _ from "lodash";
import {Genre} from "../../entity/Genre";

@Service()
export default class MediaController {

    @InjectConnection("reading")
    private connection: Connection;

    public addGenres(genres: string[]): Promise<any> {
        return new Promise(async (resolve, reject) => {
            try {
                const suspectGenres = _.uniq(genres);
                const DbExistingGenres = await this.connection.getRepository(Genre)
                    .find({where: {type: Not(In(suspectGenres))}});
                const existingGenres = DbExistingGenres.map(o => o.type);
                // console.log("genres from files", suspectGenres);
                // console.log("existing Genres", existingGenres);
                const newGenres = _.difference(suspectGenres, existingGenres);
                // console.log("new Genres", newGenres);
                const rows = newGenres.map(g => new Genre(g));
                await this.connection.manager.save(rows);
                resolve({"new genres added": newGenres});
            } catch (e) {
                console.error("could not add new genres", e);
                reject(e);
            }
        });
    }

}
